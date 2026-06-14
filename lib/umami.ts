"use client";

type UmamiPayload = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: UmamiPayload) => void;
    };
  }
}

export function trackEvent(event: string, data?: UmamiPayload) {
  if (typeof window === "undefined") return;
  window.umami?.track(event, data);
}
