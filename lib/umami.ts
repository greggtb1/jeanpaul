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

function datafastGoalAliases(event: string, data?: UmamiPayload): string[] {
  const aliases = [event];

  if (event === "landing_cta_click") {
    aliases.push("start_button_clicked");
  }

  if (event === "onboarding_step_view" && data?.step) {
    aliases.push(`onboarding_step_${data.step}_view`);
  }

  if (event === "pricing_plan_click" && data?.source === "subscribe_page") {
    aliases.push("paywall_offer_clicked");
  }

  return [...new Set(aliases)];
}

export function trackEvent(event: string, data?: UmamiPayload) {
  if (typeof window === "undefined") return;
  window.umami?.track(event, data);

  const metadata = cleanMetadata(data);
  for (const goal of datafastGoalAliases(event, data)) {
    window.datafast?.(goal, metadata);
  }
}
