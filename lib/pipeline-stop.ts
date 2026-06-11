import type { SupabaseClient } from "@supabase/supabase-js";

export function killPipelineProcess(pid: number) {
  const target = process.platform === "win32" ? pid : -pid;
  try {
    process.kill(target, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* déjà terminé */
    }
  }
  setTimeout(() => {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 3000);
}

const STOP_LINE = "⛔ Arrêt demandé — interruption en cours…";

export async function stopPipelineRun(
  admin: SupabaseClient,
  userId: string,
  runId: string,
  currentLog = ""
): Promise<{ ok: true; alreadyDone?: boolean } | { ok: false; error: string }> {
  const { error: cancelErr } = await admin.from("app_state").upsert(
    {
      id: `pipeline_cancel:${runId}`,
      user_id: userId,
      data: { cancelled: true, at: new Date().toISOString() },
    },
    { onConflict: "id" }
  );
  if (cancelErr) return { ok: false, error: cancelErr.message };

  const log = currentLog || "";
  const logAppend = log.includes(STOP_LINE) ? log : `${log}${log ? "\n" : ""}${STOP_LINE}\n`;

  const { data: updated, error: updErr } = await admin
    .from("pipeline_runs")
    .update({
      status: "cancelled",
      log: logAppend,
      finished_at: new Date().toISOString(),
      result: { cancelled: true, stopped_by: "user" },
    })
    .eq("id", runId)
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .select("id");

  if (updErr) return { ok: false, error: updErr.message };

  const { data: pidRow } = await admin
    .from("app_state")
    .select("data")
    .eq("id", `pipeline_pid:${runId}`)
    .maybeSingle();

  const pid = (pidRow?.data as { pid?: number } | null)?.pid;
  if (typeof pid === "number" && pid > 0) {
    killPipelineProcess(pid);
  }

  return { ok: true, alreadyDone: !updated?.length };
}
