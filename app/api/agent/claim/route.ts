import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintAgentJwt, mintSupabaseUserJwt } from "@/lib/agent-jwt";
import {
  consumeAgentLaunchToken,
  getAnthropicApiKey,
  getAppOrigin,
} from "@/lib/agent-launch";

export const dynamic = "force-dynamic";

const claimHits = new Map<string, { count: number; resetAt: number }>();
const CLAIM_LIMIT = 10;
const CLAIM_WINDOW_MS = 60_000;

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const row = claimHits.get(ip);
  if (!row || now > row.resetAt) {
    claimHits.set(ip, { count: 1, resetAt: now + CLAIM_WINDOW_MS });
    return true;
  }
  if (row.count >= CLAIM_LIMIT) return false;
  row.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    if (!rateLimit(ip)) {
      return NextResponse.json({ error: "Trop de tentatives. Réessayez dans 1 min." }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Token manquant." }, { status: 400 });
    }

    const admin = createAdminClient();
    const consumed = await consumeAgentLaunchToken(admin, token);
    if ("error" in consumed) {
      return NextResponse.json({ error: consumed.error }, { status: 401 });
    }

    const { userId, runId, urls } = consumed;

    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("subscription_status, email")
      .eq("id", userId)
      .maybeSingle();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }

    const subscribed =
      profile?.subscription_status === "active" ||
      profile?.subscription_status === "trialing";
    if (!subscribed) {
      return NextResponse.json({ error: "Abonnement inactif." }, { status: 403 });
    }

    const { data: run, error: runErr } = await admin
      .from("pipeline_runs")
      .select("id, status, user_id")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();

    if (runErr) {
      return NextResponse.json({ error: runErr.message }, { status: 500 });
    }
    if (!run) {
      return NextResponse.json({ error: "Run introuvable." }, { status: 404 });
    }

    const email = profile?.email || `${userId}@users.blowmyjob.local`;
    const hasJwtSecret = !!(
      process.env.SUPABASE_JWT_SECRET?.trim() || process.env.AGENT_JWT_SECRET?.trim()
    );
    const devFallback = process.env.NODE_ENV !== "production" && !hasJwtSecret;

    let supabaseAccessToken: string | null = null;
    let agentJwt = "dev";
    if (!devFallback) {
      try {
        supabaseAccessToken = mintSupabaseUserJwt(userId, email, 3600);
        agentJwt = mintAgentJwt(userId, runId, 900);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Configuration JWT manquante.";
        return NextResponse.json({ error: message }, { status: 503 });
      }
    }

    const anthropicKey = getAnthropicApiKey();
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY manquante côté serveur." },
        { status: 503 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Configuration Supabase incomplète." }, { status: 503 });
    }

    // En dev sans JWT secret : le moteur tourne avec la service role (machine locale only).
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const engineAuthEnv: Record<string, string> = supabaseAccessToken
      ? { JA_SUPABASE_ACCESS_TOKEN: supabaseAccessToken }
      : serviceRoleKey
        ? { SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }
        : {};
    if (Object.keys(engineAuthEnv).length === 0) {
      return NextResponse.json(
        { error: "SUPABASE_JWT_SECRET manquant (ou SUPABASE_SERVICE_ROLE_KEY en dev)." },
        { status: 503 }
      );
    }

    await admin
      .from("pipeline_runs")
      .update({
        status: "running",
        progress: 2,
        log: "[agent] Connexion établie — lancement du navigateur local…\n",
      })
      .eq("id", runId);

    return NextResponse.json({
      agentJwt,
      userId,
      runId,
      urls,
      supabaseUrl,
      supabaseAnonKey,
      apiOrigin: getAppOrigin(),
      engineEnv: {
        ...engineAuthEnv,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_ANON_KEY: supabaseAnonKey,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
        ANTHROPIC_API_KEY: anthropicKey,
        JA_USER_ID: userId,
        JA_RUN_ID: runId,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
