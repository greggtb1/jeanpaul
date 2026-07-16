import { createHmac, randomBytes } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const TRIAL_DEVICE_COOKIE = "ja_trial_device";

const DEVICE_TOKEN_RE = /^[a-f0-9]{64}$/;
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function guardSecret(): string {
  const secret =
    process.env.TRIAL_GUARD_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Clé du garde-fou découverte manquante.");
  return secret;
}

function hashClaim(value: string): string {
  return createHmac("sha256", guardSecret()).update(value).digest("hex");
}

function requestIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export type TrialIdentity = {
  deviceToken: string;
  deviceHash: string;
  networkDayHash: string;
};

/**
 * Empreintes opaques anti-abus :
 * - appareil : cookie aléatoire durable, jamais stocké en clair en base ;
 * - réseau : IP + user-agent + jour UTC, pour freiner les créations en rafale
 *   sans condamner durablement un réseau partagé.
 */
export function getTrialIdentity(req: NextRequest): TrialIdentity {
  const cookieToken = req.cookies.get(TRIAL_DEVICE_COOKIE)?.value ?? "";
  const deviceToken = DEVICE_TOKEN_RE.test(cookieToken)
    ? cookieToken
    : randomBytes(32).toString("hex");
  const userAgent = (req.headers.get("user-agent") || "unknown").slice(0, 300);
  const utcDay = new Date().toISOString().slice(0, 10);

  return {
    deviceToken,
    deviceHash: hashClaim(`device:${deviceToken}`),
    networkDayHash: hashClaim(`network-day:${requestIp(req)}:${userAgent}:${utcDay}`),
  };
}

export function attachTrialDeviceCookie<T extends NextResponse>(
  response: T,
  identity: TrialIdentity
): T {
  response.cookies.set(TRIAL_DEVICE_COOKIE, identity.deviceToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}
