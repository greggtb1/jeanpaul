import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { engineRunLogPath } from "@/lib/engine-spawn";
import { resolveEnginePaths } from "@/lib/engine-path";

const STOP_MARKERS = ["Arrêt demandé", "Recherche arrêtée", "Script interrompu"];
/** Ne pas réconcilier un run tout juste lancé (PID / spawn pas encore stable). */
const STARTUP_GRACE_MS = 45_000;
/** Log vide ou bootstrap seul = moteur qui ne répond pas. */
const ENGINE_SILENCE_MS = 90_000;

const BOOTSTRAP_LOG = "[api] Moteur Python lancé…";

function isEngineStillSilent(log: string): boolean {
  const trimmed = (log || "").trim();
  return !trimmed || trimmed === BOOTSTRAP_LOG;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function shouldMarkCancelled(log: string): boolean {
  return STOP_MARKERS.some((m) => log.includes(m));
}

function readEngineBootLog(runId: string): string {
  try {
    const { engineDir } = resolveEnginePaths();
    const raw = readFileSync(engineRunLogPath(engineDir, runId), "utf8").trim();
    if (!raw) return "";
    const max = 4000;
    return raw.length <= max ? raw : `… (${raw.length - max} caractères tronqués)\n${raw.slice(-max)}`;
  } catch {
    return "";
  }
}

export async function reconcileStalePipelineRun(
  admin: SupabaseClient,
  run: {
    id: string;
    user_id: string;
    status: string;
    log: string | null;
    progress: number;
    created_at?: string | null;
  }
): Promise<typeof run | null> {
  if (run.status !== "pending" && run.status !== "running") {
    return run;
  }

  const createdAt = run.created_at ? new Date(run.created_at).getTime() : 0;
  const ageMs = createdAt ? Date.now() - createdAt : Number.POSITIVE_INFINITY;

  const [{ data: cancelRow }, { data: pidRow }] = await Promise.all([
    admin
      .from("app_state")
      .select("data")
      .eq("id", `pipeline_cancel:${run.id}`)
      .maybeSingle(),
    admin
      .from("app_state")
      .select("data")
      .eq("id", `pipeline_pid:${run.id}`)
      .maybeSingle(),
  ]);

  const cancelFlag = !!(cancelRow?.data as { cancelled?: boolean } | null)?.cancelled;
  const pid = (pidRow?.data as { pid?: number } | null)?.pid;
  const log = run.log || "";
  const logStop = shouldMarkCancelled(log);

  // Run fraîchement créé : le poll GET ne doit pas le tuer (PID pas encore en base).
  if (ageMs < STARTUP_GRACE_MS && !cancelFlag && !logStop) {
    return run;
  }

  const noPid = typeof pid !== "number";
  const pidDead = typeof pid === "number" ? !isProcessAlive(pid) : false;
  const staleWithoutPid = noPid && ageMs >= STARTUP_GRACE_MS;
  const engineSilent = isEngineStillSilent(log) && ageMs >= ENGINE_SILENCE_MS;

  if (!cancelFlag && !pidDead && !logStop && !staleWithoutPid && !engineSilent) {
    return run;
  }

  const reason = engineSilent
    ? "engine_silent"
    : cancelFlag
      ? "cancel_flag"
      : logStop
        ? "log_marker"
        : staleWithoutPid
          ? "no_pid"
          : "process_dead";

  const engineBootLog = reason === "process_dead" || reason === "no_pid"
    ? readEngineBootLog(run.id)
    : "";

  const logAppend = log.includes("Arrêt demandé")
    ? log
    : engineSilent
      ? `${log}${log ? "\n" : ""}❌ Moteur sans réponse après ${Math.round(ENGINE_SILENCE_MS / 1000)}s. Vérifiez ENGINE_DIR / SUPABASE_SERVICE_ROLE_KEY sur le serveur.\n`
      : reason === "process_dead" || reason === "no_pid"
        ? `${log}${log ? "\n" : ""}❌ Le moteur s'est arrêté avant de démarrer.${engineBootLog ? `\n── Sortie moteur ──\n${engineBootLog}\n` : ""}`
        : `${log}${log ? "\n" : ""}🛑 Run interrompu. État réconcilié au chargement.\n`;

  const failed = reason === "engine_silent" || reason === "process_dead" || reason === "no_pid";

  const { data: updated, error } = await admin
    .from("pipeline_runs")
    .update({
      status: failed ? "failed" : "cancelled",
      log: logAppend,
      finished_at: new Date().toISOString(),
      result: {
        cancelled: !failed,
        reconciled: true,
        reason,
      },
    })
    .eq("id", run.id)
    .in("status", ["pending", "running"])
    .select("*")
    .maybeSingle();

  if (error || !updated) return run;
  return updated as typeof run;
}

/** Limite la taille du log renvoyé au navigateur (perf). */
export function trimPipelineLog(log: string, maxChars = 48_000): string {
  if (log.length <= maxChars) return log;
  return `… (${log.length - maxChars} caractères tronqués)\n` + log.slice(-maxChars);
}
