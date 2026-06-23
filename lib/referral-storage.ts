import { planQuery, type BillingInterval, type PlanId } from "@/lib/plans";
import { getPublicAppOrigin } from "@/lib/app-url";
import { validateReferralCode } from "@/lib/referrals";

const STORAGE_KEY = "aiapply_referral_code";
const COOKIE_KEY = "aiapply_ref";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

function readReferralCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${COOKIE_KEY}=`;
  const entry = document.cookie.split(";").find((c) => c.trim().startsWith(prefix));
  if (!entry) return null;
  const raw = decodeURIComponent(entry.trim().slice(prefix.length));
  return validateReferralCode(raw);
}

function writeReferralCookie(code: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(code)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function persistReferralCode(raw: string | null | undefined): string | null {
  if (typeof window === "undefined") return null;
  const code = validateReferralCode(raw ?? "");
  if (!code) return null;
  window.localStorage.setItem(STORAGE_KEY, code);
  writeReferralCookie(code);
  return code;
}

export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const valid = validateReferralCode(stored);
    if (valid) return valid;
  }
  return readReferralCookie();
}

export function clearStoredReferralCode() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  }
}

/** URL > localStorage > cookie */
export function resolveReferralCode(urlRef?: string | null): string | null {
  const fromUrl = validateReferralCode(urlRef ?? "");
  if (fromUrl) return persistReferralCode(fromUrl) ?? fromUrl;
  return getStoredReferralCode();
}

/** Lien onboarding avec le code dans l’URL (parcours complet). */
export function buildReferralOnboardingUrl(
  code: string,
  origin = getPublicAppOrigin(),
  planId?: PlanId,
  billing?: BillingInterval
): string {
  const normalized = validateReferralCode(code);
  if (!normalized || !origin) return "";
  const params = new URLSearchParams({ ref: normalized });
  if (planId) {
    const q = planQuery(planId, billing);
    new URLSearchParams(q.replace(/^\?/, "")).forEach((v, k) => params.set(k, v));
  }
  return `${origin}/onboarding?${params.toString()}`;
}

export function appendRefToPath(path: string, code: string | null | undefined): string {
  const normalized = validateReferralCode(code ?? "");
  if (!normalized) return path;
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("ref", normalized);
  return `${base}?${params.toString()}`;
}
