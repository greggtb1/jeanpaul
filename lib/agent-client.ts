"use client";

/** Ouvre le deep link de l'agent desktop (blowmyjob://). */
export function openAgentDeepLink(deepLink: string): void {
  if (!deepLink.startsWith("blowmyjob://")) return;
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = deepLink;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 2000);
  window.location.href = deepLink;
}
