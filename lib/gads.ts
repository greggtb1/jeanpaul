"use client";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

/** Identifiant Google Ads (balise globale gtag.js). */
export const GOOGLE_ADS_ID = "AW-18275211435";

/**
 * Libellé de l'action de conversion « Achat » Google Ads.
 * Dans Google Ads → Objectifs → Conversions → ton action → « Configurer la balise »,
 * le send_to ressemble à "AW-18275211435/AbCdEf12GhIjKl". Colle ici (ou via la
 * variable d'env NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL) la partie après le « / ».
 */
const PURCHASE_CONVERSION_LABEL =
  process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL?.trim() || "41FACJC_-8UcEKuxpopE";

type PurchaseConversion = {
  /** Valeur de la conversion en euros (montant réellement payé). */
  value?: number;
  currency?: string;
  /** Identifiant unique de la transaction (= session Stripe) pour éviter les doublons. */
  transactionId?: string;
  email?: string | null;
};

/**
 * Déclenche une conversion d'achat côté Google Ads.
 *
 * La balise globale est chargée sur toutes les pages (cf. layout.tsx) : le clic
 * d'annonce dépose le GCLID dans le cookie first-party `_gcl_aw`, qui survit à
 * l'aller-retour vers Stripe. On déclenche donc la conversion ici, au retour sur
 * la page de succès, et l'attribution remonte correctement.
 */
export function trackAdsPurchase({
  value,
  currency = "EUR",
  transactionId,
  email,
}: PurchaseConversion) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  if (!PURCHASE_CONVERSION_LABEL) return;

  // Enhanced conversions : améliore la correspondance (email haché côté Google).
  if (email) {
    window.gtag("set", "user_data", { email });
  }

  window.gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_ID}/${PURCHASE_CONVERSION_LABEL}`,
    value,
    currency,
    transaction_id: transactionId,
  });
}
