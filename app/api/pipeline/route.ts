import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildEngineSpawnEnv, getEngineServiceKey } from "@/lib/engine-env";
import { engineUnavailableMessage, resolveEnginePaths } from "@/lib/engine-path";
import { spawnEngineProcess } from "@/lib/engine-spawn";
import { stopPipelineRun } from "@/lib/pipeline-stop";
import { reconcileStalePipelineRun, trimPipelineLog } from "@/lib/pipeline-reconcile";
import { assertPipelineQuota, countGeneratedJobs, TRIAL_DISCOVERY_GEN_MAX } from "@/lib/plan-quota";
import { createAgentLaunchToken } from "@/lib/agent-launch";
import { isTrialDecoyJob } from "@/lib/trial-decoy";

export const dynamic = "force-dynamic";

// Rattrapage borné pour l'essai découverte : uniquement pour terminer les 4
// dossiers gratuits (offres déjà trouvées) ou relancer un scan si rien n'est
// sorti du tout. Jamais de génération/scan illimité.
const TRIAL_CATCHUP_HUNT_TARGET = 8;
const TRIAL_CATCHUP_MAX_ATTEMPTS = 4;

async function requireSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user };
}

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { supabase, user } = session;
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ run: null });

    let row = data;
    if (row.status === "pending" || row.status === "running") {
      try {
        const admin = createAdminClient();
        const reconciled = await reconcileStalePipelineRun(admin, row);
        if (reconciled) row = reconciled;
      } catch {
        /* service role absent — on renvoie l'état brut */
      }
    }

    return NextResponse.json({
      run: {
        id: row.id,
        status: row.status,
        progress: row.progress,
        log: trimPipelineLog(row.log || ""),
        result: row.result ?? null,
        created_at: row.created_at,
        finished_at: row.finished_at,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const mode =
      body.mode === "autoapply"
        ? "autoapply"
        : body.mode === "import"
          ? "import"
          : body.mode === "analyze"
            ? "analyze"
            : body.mode === "unlock"
              ? "unlock"
              : "full";
    const urls = Array.isArray(body.urls)
      ? (body.urls as string[]).filter((u) => typeof u === "string" && u.trim())
      : [];
    const importUrl = typeof body.import_url === "string" ? body.import_url.trim() : "";

    if (mode === "import") {
      try {
        const parsed = new URL(importUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return NextResponse.json({ error: "Lien d'offre invalide" }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "Lien d'offre invalide" }, { status: 400 });
      }
    }

    const { supabase, user } = session;
    const userId = user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status, plan_id, first_search_done, bonus_credits")
      .eq("id", userId)
      .maybeSingle();

    const subscribed =
      profile?.subscription_status === "active" ||
      profile?.subscription_status === "trialing";

    let admin;
    try {
      admin = createAdminClient();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Configuration serveur incomplète";
      return NextResponse.json({ error: message }, { status: 503 });
    }

    // Rattrapage borné de l'essai découverte : jamais de scan/génération illimité.
    let trialCatchup: { huntTarget: number; genMax: number } | null = null;

    if (!subscribed) {
      if (profile?.subscription_status !== "trial") {
        return NextResponse.json({ error: "Abonnement inactif" }, { status: 403 });
      }

      const trialLockedResponse = () =>
        NextResponse.json(
          {
            error: "Première recherche terminée. Choisissez un plan pour relancer une recherche.",
            trialLocked: true,
          },
          { status: 403 }
        );

      if (mode !== "analyze" && mode !== "full") return trialLockedResponse();

      const { data: trialJobsRaw } = await admin
        .from("jobs")
        .select("url,data,cv_url,fit_score")
        .eq("user_id", userId)
        .eq("deleted", false);
      const trialJobs = trialJobsRaw ?? [];
      const realJobsCount = trialJobs.filter(
        (j) => !isTrialDecoyJob({ url: j.url ?? "", data: j.data ?? {} })
      ).length;
      const generatedCount = countGeneratedJobs(trialJobs);
      const remainingSlots = Math.max(0, TRIAL_DISCOVERY_GEN_MAX - generatedCount);
      const noOffersFound = realJobsCount === 0;

      // Seul cas autorisé : finir les 4 dossiers découverte, ou relancer un scan
      // si aucune offre n'est jamais sortie. Rien d'autre ne doit passer ici.
      const catchupAllowed =
        (mode === "analyze" && remainingSlots > 0) || (mode === "full" && noOffersFound);
      if (!catchupAllowed) return trialLockedResponse();

      const attemptsId = `trial_catchup_attempts:${userId}`;
      const { data: attemptsRow } = await admin
        .from("app_state")
        .select("data")
        .eq("id", attemptsId)
        .maybeSingle();
      const attempts = Number(
        (attemptsRow?.data as { count?: number } | null)?.count ?? 0
      );
      if (attempts >= TRIAL_CATCHUP_MAX_ATTEMPTS) return trialLockedResponse();

      await admin.from("app_state").upsert(
        { id: attemptsId, user_id: userId, data: { count: attempts + 1 } },
        { onConflict: "id" }
      );

      trialCatchup =
        mode === "full"
          ? { huntTarget: TRIAL_CATCHUP_HUNT_TARGET, genMax: TRIAL_DISCOVERY_GEN_MAX }
          : { huntTarget: TRIAL_CATCHUP_HUNT_TARGET, genMax: remainingSlots };
    }

    const quota = await assertPipelineQuota(admin, userId, mode, profile ?? {});
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error, quotaExceeded: true }, { status: 403 });
    }

    const { data: active } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (active) {
      try {
        const admin = createAdminClient();
        const reconciled = await reconcileStalePipelineRun(admin, active);
        if (
          reconciled &&
          (reconciled.status === "pending" || reconciled.status === "running")
        ) {
          return NextResponse.json({ runId: active.id, alreadyRunning: true });
        }
      } catch {
        return NextResponse.json({ runId: active.id, alreadyRunning: true });
      }
    }

    const runId = randomUUID();
    const { error: insErr } = await supabase.from("pipeline_runs").insert({
      id: runId,
      user_id: userId,
      status: "pending",
      log: "",
      progress: 0,
    });

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    if (mode === "autoapply" && urls.length) {
      const { error: selErr } = await admin.from("app_state").upsert({
        id: `autoapply_selection:${userId}`,
        user_id: userId,
        data: { urls },
      });
      if (selErr) {
        return NextResponse.json({ error: selErr.message }, { status: 500 });
      }
    }

    if (mode === "import") {
      const { error: importErr } = await admin.from("app_state").upsert({
        id: `import_offer:${runId}`,
        user_id: userId,
        data: { url: importUrl },
      });
      if (importErr) {
        return NextResponse.json({ error: importErr.message }, { status: 500 });
      }
    }

    await admin.from("app_state").delete().eq("id", `pipeline_cancel:${runId}`);

    if (mode === "autoapply") {
      try {
        const { deepLink } = await createAgentLaunchToken(admin, userId, runId, urls);
        await admin
          .from("pipeline_runs")
          .update({
            status: "pending",
            progress: 0,
            log: "[api] En attente de l'agent desktop…\n",
          })
          .eq("id", runId);

        return NextResponse.json({
          runId,
          started: true,
          executor: "desktop",
          deepLink,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Impossible de créer le lien agent.";
        await admin
          .from("pipeline_runs")
          .update({
            status: "failed",
            log: `${message}\n`,
            finished_at: new Date().toISOString(),
            result: { error: "agent_launch_failed" },
          })
          .eq("id", runId);
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    const engine = resolveEnginePaths();

    if (!engine.python || !engine.scriptOk) {
      const detail = engineUnavailableMessage(engine);
      await admin
        .from("pipeline_runs")
        .update({
          status: "failed",
          log: `${detail}\n`,
          finished_at: new Date().toISOString(),
          result: { error: "engine_missing" },
        })
        .eq("id", runId);
      return NextResponse.json({ error: detail }, { status: 503 });
    }

    if (!getEngineServiceKey()) {
      await admin
        .from("pipeline_runs")
        .update({
          status: "failed",
          log: "Configuration serveur incomplète : SUPABASE_SERVICE_ROLE_KEY manquante dans .env.local.\n",
          finished_at: new Date().toISOString(),
          result: { error: "engine_config" },
        })
        .eq("id", runId);
      return NextResponse.json(
        {
          error:
            "Moteur non configuré. Ajoutez SUPABASE_SERVICE_ROLE_KEY dans .env.local (Supabase → Settings → API).",
        },
        { status: 503 }
      );
    }

    const child = spawnEngineProcess(
      engine,
      runId,
      [
        "--user-id",
        userId,
        "--run-id",
        runId,
        "--mode",
        mode,
        ...(mode === "import" ? ["--import-url", importUrl] : []),
      ],
      {
        ...buildEngineSpawnEnv(userId, runId),
        JA_HUNT_TARGET: String(trialCatchup ? trialCatchup.huntTarget : quota.runTarget),
        ...(mode === "unlock" ? { JA_GEN_MAX: String(quota.runTarget) } : {}),
        ...(trialCatchup ? { JA_GEN_MAX: String(trialCatchup.genMax) } : {}),
      }
    );

    if (child.pid) {
      const { error: pidErr } = await supabase.from("app_state").upsert(
        {
          id: `pipeline_pid:${runId}`,
          user_id: userId,
          data: { pid: child.pid },
        },
        { onConflict: "id" }
      );
      if (pidErr) {
        return NextResponse.json({ error: pidErr.message }, { status: 500 });
      }
    }

    child.unref();

    await admin
      .from("pipeline_runs")
      .update({
        status: "running",
        progress: 2,
        log: "[api] Moteur Python lancé…\n",
      })
      .eq("id", runId);

    if (mode === "full") {
      await admin
        .from("profiles")
        .update({
          first_search_done: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);
    }

    return NextResponse.json({ runId, started: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const runIdParam = req.nextUrl.searchParams.get("runId");
    const { supabase, user } = session;
    const userId = user.id;

    let runId = runIdParam;
    if (!runId) {
      const { data: active } = await supabase
        .from("pipeline_runs")
        .select("id")
        .eq("user_id", userId)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      runId = active?.id;
    }

    if (!runId) {
      return NextResponse.json({ error: "Aucun script en cours" }, { status: 404 });
    }

    const { data: run, error: runErr } = await supabase
      .from("pipeline_runs")
      .select("id, status, log")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();

    if (runErr) {
      return NextResponse.json({ error: runErr.message }, { status: 500 });
    }
    if (!run) {
      return NextResponse.json({ error: "Run introuvable" }, { status: 404 });
    }

    if (run.status !== "pending" && run.status !== "running") {
      return NextResponse.json({ stopped: true, runId, alreadyDone: true });
    }

    let admin;
    try {
      admin = createAdminClient();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Configuration serveur incomplète";
      return NextResponse.json({ error: message }, { status: 503 });
    }

    const result = await stopPipelineRun(admin, userId, runId, run.log || "");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      stopped: true,
      runId,
      alreadyDone: result.alreadyDone,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
