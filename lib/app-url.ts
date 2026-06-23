const PROD_ORIGIN = "https://blowmyjob.fr";

/** Origine publique pour liens partagés (parrainage, emails, etc.). */
export function getPublicAppOrigin(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      /* ignore */
    }
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "blowmyjob.fr" || host === "www.blowmyjob.fr") {
      return window.location.origin;
    }
  }

  return PROD_ORIGIN;
}
