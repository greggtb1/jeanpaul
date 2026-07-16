import { planQuery, type BillingInterval, type PlanId } from "@/lib/plans";
import { getPublicAppOrigin } from "@/lib/app-url";
import { validateReferralCode } from "@/lib/referrals";

const STORAGE_KEY = "aiapply_referral_code";
// Cookie renommé : les anciens cookies « aiapply_ref » (persistance 90 jours)
// sont ainsi ignorés et ne s'appliquent plus.
const COOKIE_KEY = "aiapply_ref_s";
const LEGACY_COOKIE_KEY = "aiapply_ref";

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readReferralCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${COOKIE_KEY}=`;
  const entry = document.cookie.split(";").find((c) => c.trim().startsWith(prefix));
  if (!entry) return null;
  const raw = decodeURIComponent(entry.trim().slice(prefix.length));
  return validateReferralCode(raw);
}

// Cookie de session (pas de max-age) → l'attribution est limitée au parcours
// en cours et ne survit pas à la fermeture du navigateur.
function writeReferralCookie(code: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(code)}; path=/; SameSite=Lax`;
}

function clearLegacyStorage() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== "undefined") {
    document.cookie = `${LEGACY_COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export function persistReferralCode(raw: string | null | undefined): string | null {
  if (typeof window === "undefined") return null;
  const code = validateReferralCode(raw ?? "");
  if (!code) return null;
  sessionStore()?.setItem(STORAGE_KEY, code);
  writeReferralCookie(code);
  clearLegacyStorage();
  return code;
}

export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStore()?.getItem(STORAGE_KEY);
  if (stored) {
    const valid = validateReferralCode(stored);
    if (valid) return valid;
  }
  return readReferralCookie();
}

export function clearStoredReferralCode() {
  if (typeof window === "undefined") return;
  sessionStore()?.removeItem(STORAGE_KEY);
  if (typeof document !== "undefined") {
    document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
  }
  clearLegacyStorage();
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
