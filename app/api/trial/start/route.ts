import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildEngineSpawnEnv, getEngineServiceKey } from "@/lib/engine-env";
import { engineUnavailableMessage, resolveEnginePaths } from "@/lib/engine-path";
import { spawnEngineProcess } from "@/lib/engine-spawn";
import { draftToProfilePayload, type OnboardingDraft } from "@/lib/onboarding-draft";
import { isTrialDiscoveryComplete } from "@/lib/trial-discovery";
import {
  attachTrialDeviceCookie,
  getTrialIdentity,
} from "@/lib/trial-guard";

export const dynamic = "force-dynamic";

// Scan découverte bridé : 8 offres analysées, 4 dossiers CV+lettre générés.
const TRIAL_HUNT_TARGET = 8;
const TRIAL_GEN_MAX = 4;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const draft = (body?.draft ?? null) as OnboardingDraft | null;
    const prepareOnly = body?.prepare_only === true;
    if (!draft || !Array.isArray(draft.target_roles) || !draft.target_roles.length) {
      return NextResponse.json({ error: "Profil d'onboarding incomplet" }, { status: 400 });
    }

    let admin;
    try {
      admin = createAdminClient();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Configuration serveur incomplète";
      return NextResponse.json({ error: message }, { status: 503 });
    }

    const identity = getTrialIdentity(req);
    const trialJson = (body: Record<string, unknown>, status = 200) =>
      attachTrialDeviceCookie(NextResponse.json(body, { status }), identity);

    const { data: existing } = await admin
      .from("profiles")
      .select("subscription_status,trial_used,first_search_done")
      .eq("id", user.id)
      .maybeSingle();

    if (
      existing?.subscription_status === "active" ||
      existing?.subscription_status === "trialing"
    ) {
      return trialJson(
        {
          error: "Votre session est déjà active",
          existingSession: true,
          redirectTo: "/dashboard",
        },
        409
      );
    }

    // Un double clic pendant le lancement doit rejoindre le run existant,
    // même si l'essai vient déjà d'être marqué comme consommé.
    if (!prepareOnly) {
      const { data: active } = await admin
        .from("pipeline_runs")
        .select("id")
        .eq("user_id", user.id)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (active) {
        return trialJson({ runId: active.id, alreadyRunning: true });
      }
    }

    const [{ data: userJobs }, { data: priorClaims, error: claimsReadError }] =
      await Promise.all([
        admin
          .from("jobs")
          .select("url,data,cv_url,fit_score")
          .eq("user_id", user.id)
          .eq("deleted", false),
        admin
          .from("trial_claims")
          .select("user_id,claim_type")
          .in("claim_hash", [identity.deviceHash, identity.networkDayHash])
          .limit(2),
      ]);

    if (claimsReadError) {
      return trialJson({ error: "Garde-fou découverte indisponible" }, 503);
    }

    const claimedByCurrentUser = (priorClaims ?? []).some(
      (claim) => claim.user_id === user.id
    );
    const claimedByAnotherUser = (priorClaims ?? []).some(
      (claim) => claim.user_id !== user.id
    );
    const recognizedSession =
      existing?.subscription_status === "trial" || claimedByCurrentUser;
    const claimRows = [
      {
        claim_type: "device",
        claim_hash: identity.deviceHash,
        user_id: user.id,
      },
      {
        claim_type: "network_day",
        claim_hash: identity.networkDayHash,
        user_id: user.id,
      },
    ];

    if (
      existing?.trial_used ||
      existing?.first_search_done ||
      isTrialDiscoveryComplete(userJobs ?? [])
    ) {
      // Les essais antérieurs au garde-fou sont rattachés au navigateur dès
      // leur prochaine visite, avant une éventuelle déconnexion anonyme.
      if (recognizedSession && (priorClaims ?? []).length === 0) {
        await admin
          .from("trial_claims")
          .upsert(claimRows, {
            onConflict: "claim_type,claim_hash",
            ignoreDuplicates: true,
          });
      }
      return trialJson(
        {
          error: recognizedSession
            ? "Votre session découverte existe déjà"
            : "Votre essai gratuit est terminé",
          trialUsed: true,
          existingSession: recognizedSession,
          redirectTo: recognizedSession ? "/dashboard" : "/subscribe?trial_used=1",
        },
        409
      );
    }

    if (claimedByAnotherUser) {
      return trialJson(
        {
          error: "Un essai découverte a déjà été utilisé depuis cet appareil",
          trialUsed: true,
          existingSession: claimedByCurrentUser,
          redirectTo: claimedByCurrentUser ? "/dashboard" : "/subscribe?trial_used=1",
        },
        409
      );
    }

    if (prepareOnly && existing?.subscription_status === "trial") {
      return trialJson(
        {
          prepared: true,
          existingSession: true,
          redirectTo: "/dashboard",
        }
      );
    }

    const payload = {
      ...draftToProfilePayload(draft, user.id),
      is_trial: true,
      subscription_status: "trial",
      plan_id: draft.plan_id || null,
    };

    const { error: upsertError } = await admin.from("profiles").upsert(payload);
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    if (prepareOnly) {
      return trialJson({ prepared: true });
    }

    const engine = resolveEnginePaths();
    if (!engine.python || !engine.scriptOk) {
      const detail = engineUnavailableMessage(engine);
      return trialJson({ error: detail }, 503);
    }

    if (!getEngineServiceKey()) {
      return trialJson(
        { error: "Moteur non configuré (SUPABASE_SERVICE_ROLE_KEY manquante)." },
        503
      );
    }

    const claimsToInsert = claimRows.filter(
      (row) =>
        !(priorClaims ?? []).some(
          (claim) =>
            claim.user_id === user.id && claim.claim_type === row.claim_type
        )
    );
    const { error: claimError } = claimsToInsert.length
      ? await admin.from("trial_claims").insert(claimsToInsert)
      : { error: null };
    if (claimError) {
      if (claimError.code === "23505") {
        return trialJson(
          {
            error: "Un essai découverte a déjà été utilisé depuis cet appareil",
            trialUsed: true,
            redirectTo: "/subscribe?trial_used=1",
          },
          409
        );
      }
      return trialJson({ error: "Impossible de réserver votre essai découverte" }, 500);
    }

    const rollbackClaim = async () => {
      const insertedClaimHashes = claimsToInsert.map((claim) => claim.claim_hash);
      if (insertedClaimHashes.length) {
        await admin
          .from("trial_claims")
          .delete()
          .eq("user_id", user.id)
          .in("claim_hash", insertedClaimHashes);
      }
      await admin
        .from("profiles")
        .update({ trial_used: false, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .eq("first_search_done", false);
    };

    const { error: consumeError } = await admin
      .from("profiles")
      .update({ trial_used: true, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (consumeError) {
      await rollbackClaim();
      return trialJson({ error: "Impossible d'activer votre essai découverte" }, 500);
    }

    const runId = randomUUID();
    const { error: insErr } = await admin.from("pipeline_runs").insert({
      id: runId,
      user_id: user.id,
      status: "pending",
      log: "",
      progress: 0,
    });
    if (insErr) {
      await rollbackClaim();
      return trialJson({ error: insErr.message }, 500);
    }

    // Une recherche découverte autorisée repart toujours d'une liste propre.
    const { error: purgeError } = await admin
      .from("jobs")
      .update({ deleted: true, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("deleted", false);
    if (purgeError) {
      await admin
        .from("pipeline_runs")
        .update({
          status: "failed",
          log: "Nettoyage des anciens dossiers impossible.\n",
          finished_at: new Date().toISOString(),
          result: { error: "trial_cleanup_failed" },
        })
        .eq("id", runId);
      await rollbackClaim();
      return trialJson({ error: "Impossible de nettoyer l'ancienne recherche" }, 500);
    }

    await admin.from("app_state").delete().eq("id", `pipeline_cancel:${runId}`);

    const child = spawnEngineProcess(
      engine,
      runId,
      ["--user-id", user.id, "--run-id", runId, "--mode", "full"],
      {
        ...buildEngineSpawnEnv(user.id, runId),
        JA_HUNT_TARGET: String(TRIAL_HUNT_TARGET),
        JA_GEN_MAX: String(TRIAL_GEN_MAX),
      }
    );

    if (child.pid) {
      await admin.from("app_state").upsert(
        {
          id: `pipeline_pid:${runId}`,
          user_id: user.id,
          data: { pid: child.pid },
        },
        { onConflict: "id" }
      );
    }

    child.unref();

    await admin
      .from("pipeline_runs")
      .update({
        status: "running",
        progress: 2,
        log: "[api] Recherche lancée…\n",
      })
      .eq("id", runId);

    return trialJson({ runId, started: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Rattache au navigateur une session découverte existante avant déconnexion. */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("subscription_status,is_trial,trial_used,first_search_done")
      .eq("id", user.id)
      .maybeSingle();

    const isDiscoverySession =
      profile?.subscription_status === "trial" ||
      profile?.is_trial === true ||
      profile?.trial_used === true ||
      profile?.first_search_done === true;
    if (!isDiscoverySession) {
      return NextResponse.json({ existingSession: false });
    }

    const identity = getTrialIdentity(req);
    const { error } = await admin.from("trial_claims").upsert(
      [
        {
          claim_type: "device",
          claim_hash: identity.deviceHash,
          user_id: user.id,
        },
        {
          claim_type: "network_day",
          claim_hash: identity.networkDayHash,
          user_id: user.id,
        },
      ],
      {
        onConflict: "claim_type,claim_hash",
        ignoreDuplicates: true,
      }
    );
    if (error) {
      return attachTrialDeviceCookie(
        NextResponse.json({ error: "Garde-fou découverte indisponible" }, { status: 503 }),
        identity
      );
    }

    return attachTrialDeviceCookie(
      NextResponse.json({ existingSession: true }),
      identity
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
