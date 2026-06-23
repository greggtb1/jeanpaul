import { createHmac } from "crypto";

function base64urlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signHs256(header: string, payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
}

/** JWT Supabase `authenticated` pour le moteur Python (RLS user). */
export function mintSupabaseUserJwt(
  userId: string,
  email: string,
  expiresInSec = 3600
): string {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET manquant (Supabase → Settings → API → JWT Secret).");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64urlJson({
    aud: "authenticated",
    exp: now + expiresInSec,
    iat: now,
    sub: userId,
    email,
    role: "authenticated",
  });
  const sig = signHs256(header, payload, secret);
  return `${header}.${payload}.${sig}`;
}

/** JWT court pour l'agent desktop (appels API futurs). */
export function mintAgentJwt(userId: string, runId: string, expiresInSec = 900): string {
  const secret =
    process.env.AGENT_JWT_SECRET?.trim() ||
    process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("AGENT_JWT_SECRET ou SUPABASE_JWT_SECRET manquant.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64urlJson({
    aud: "blowmyjob-agent",
    exp: now + expiresInSec,
    iat: now,
    sub: userId,
    runId,
    role: "agent",
  });
  const sig = signHs256(header, payload, secret);
  return `${header}.${payload}.${sig}`;
}

export function verifyAgentJwt(token: string): { userId: string; runId: string } | null {
  const secret =
    process.env.AGENT_JWT_SECRET?.trim() ||
    process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = signHs256(header, payload, secret);
  if (sig !== expected) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string;
      runId?: string;
      exp?: number;
      aud?: string;
    };
    if (body.aud !== "blowmyjob-agent" || !body.sub || !body.runId) return null;
    if (typeof body.exp === "number" && body.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: body.sub, runId: body.runId };
  } catch {
    return null;
  }
}
