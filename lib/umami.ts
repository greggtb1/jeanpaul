"use client";

type UmamiPayload = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: UmamiPayload) => void;
    };
    datafast?: (goalName: string, metadata?: Record<string, string>) => void;
  }
}

function cleanMetadata(data?: UmamiPayload): Record<string, string> | undefined {
  if (!data) return undefined;
  const metadata = Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value).slice(0, 255)])
  );
  return Object.keys(metadata).length ? metadata : undefined;
}

// Events envoyés à Umami mais PAS à DataFast (bruit ou doublon d'un autre goal),
// pour économiser le quota d'events DataFast sans perdre le détail côté Umami.
const DATAFAST_SKIP = new Set<string>([
  "onboarding_step_next", // doublon de onboarding_step_view (chaque next → une vue)
  "onboarding_step_back", // navigation, sans valeur conversion
  "onboarding_complete_attempt", // doublon de onboarding_completed
  "onboarding_salary_skip", // détail navigation
  "pipeline_start_clicked", // doublon de pipeline_started
  "trial_scan_start_clicked", // doublon de trial_scan_started
  "checkout_redirected", // doublon de checkout_started
  "onboarding_cv_uploaded", // doublon de onboarding_cv_parsed
  "onboarding_complete_error",
  "onboarding_cv_upload_error",
  "trial_scan_start_error",
  "pipeline_start_error",
  "checkout_error",
  "signup_error",
]);

/**
 * Traduit un event en goals DataFast.
 * On ne renvoie QUE les goals utiles (funnels + conversions), pas le nom brut
 * quand il ferait doublon avec un goal nommé.
 */
function datafastGoalAliases(event: string, data?: UmamiPayload): string[] {
  if (DATAFAST_SKIP.has(event)) return [];

  // Étapes onboarding : seul le goal par étape alimente le funnel.
  if (event === "onboarding_step_view") {
    return data?.step ? [`onboarding_step_${data.step}_view`] : [];
  }

  // CTA d'acquisition : un seul goal (utilisé par le funnel onboarding).
  if (event === "landing_cta_click") {
    return ["start_button_clicked"];
  }
  if (event === "pricing_plan_click") {
    const aliases = ["start_button_clicked"];
    if (data?.source === "subscribe_page") aliases.push("paywall_offer_clicked");
    return aliases;
  }

  // Paywalls : goals contextualisés utilisés par les funnels par déclencheur.
  if (event === "trial_paywall_shown") {
    return data?.context ? [`paywall_view_${data.context}`] : [];
  }
  if (event === "trial_paywall_cta_clicked") {
    const aliases = ["paywall_offer_clicked"];
    if (data?.context) aliases.push(`paywall_click_${data.context}`);
    return aliases;
  }
  if (event === "trial_banner_cta_clicked") {
    return ["paywall_offer_clicked", "paywall_click_banner"];
  }

  return [event];
}

export function trackEvent(event: string, data?: UmamiPayload) {
  if (typeof window === "undefined") return;
  window.umami?.track(event, data);

  const metadata = cleanMetadata(data);
  for (const goal of [...new Set(datafastGoalAliases(event, data))]) {
    window.datafast?.(goal, metadata);
  }
}
