import type { SupabaseClient } from "@supabase/supabase-js";

const STOP_MARKERS = ["Arrêt demandé", "Recherche arrêtée", "Script interrompu"];
/** Ne pas réconcilier un run tout juste lancé (PID / spawn pas encore stable). */
const STARTUP_GRACE_MS = 45_000;

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
  const logStop = shouldMarkCancelled(run.log || "");

  // Run fraîchement créé : le poll GET ne doit pas le tuer (PID pas encore en base).
  if (ageMs < STARTUP_GRACE_MS && !cancelFlag && !logStop) {
    return run;
  }

  const noPid = typeof pid !== "number";
  const pidDead = typeof pid === "number" ? !isProcessAlive(pid) : false;
  const staleWithoutPid = noPid && ageMs >= STARTUP_GRACE_MS;

  if (!cancelFlag && !pidDead && !logStop && !staleWithoutPid) {
    return run;
  }

  const log = run.log || "";
  const logAppend = log.includes("Arrêt demandé")
    ? log
    : `${log}${log ? "\n" : ""}🛑 Run interrompu — état réconcilié au chargement.\n`;

  const { data: updated, error } = await admin
    .from("pipeline_runs")
    .update({
      status: "cancelled",
      log: logAppend,
      finished_at: new Date().toISOString(),
      result: {
        cancelled: true,
        reconciled: true,
        reason: cancelFlag
          ? "cancel_flag"
          : logStop
            ? "log_marker"
            : staleWithoutPid
              ? "no_pid"
              : "process_dead",
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
