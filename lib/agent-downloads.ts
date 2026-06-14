export type AgentDownload = {
  id: string;
  label: string;
  file: string;
  hint: string;
};

export const AGENT_DOWNLOADS: AgentDownload[] = [
  {
    id: "mac-arm",
    label: "macOS (Apple Silicon)",
    file: "JEAN-PAUL-Agent_aarch64.dmg",
    hint: "Mac M1 / M2 / M3",
  },
  {
    id: "win",
    label: "Windows",
    file: "JEAN-PAUL-Agent_x64-setup.exe",
    hint: "Windows 10/11",
  },
];

/** Base URL publique des installateurs (sans slash final). */
export function agentReleaseBase(origin?: string): string {
  const configured = process.env.NEXT_PUBLIC_AGENT_RELEASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (origin) return `${origin.replace(/\/$/, "")}/downloads/agent`;
  return "/downloads/agent";
}

export function agentDownloadHref(base: string, file: string): string {
  return `${base}/${encodeURIComponent(file)}`;
}
