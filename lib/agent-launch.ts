import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const AGENT_LAUNCH_TTL_MS = 5 * 60 * 1000;
export const AGENT_DEEP_LINK_SCHEME = "jeanpaul://autoapply";

export type AgentLaunchPayload = {
  userId: string;
  runId: string;
  urls: string[];
  expiresAt: string;
};

export function agentLaunchStateId(token: string): string {
  return `agent_launch:${token}`;
}

export async function createAgentLaunchToken(
  admin: SupabaseClient,
  userId: string,
  runId: string,
  urls: string[]
): Promise<{ token: string; deepLink: string; expiresAt: string }> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + AGENT_LAUNCH_TTL_MS).toISOString();
  const payload: AgentLaunchPayload = { userId, runId, urls, expiresAt };

  const { error } = await admin.from("app_state").insert({
    id: agentLaunchStateId(token),
    user_id: userId,
    data: payload,
  });
  if (error) throw new Error(error.message);

  const deepLink = `${AGENT_DEEP_LINK_SCHEME}?token=${encodeURIComponent(token)}`;
  return { token, deepLink, expiresAt };
}

export async function consumeAgentLaunchToken(
  admin: SupabaseClient,
  token: string
): Promise<AgentLaunchPayload | { error: string }> {
  const id = agentLaunchStateId(token.trim());
  const { data, error } = await admin
    .from("app_state")
    .select("data")
    .eq("id", id)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data?.data) return { error: "Token invalide ou déjà utilisé." };

  const payload = data.data as AgentLaunchPayload;
  if (!payload.userId || !payload.runId || !payload.expiresAt) {
    await admin.from("app_state").delete().eq("id", id);
    return { error: "Token corrompu." };
  }

  if (new Date(payload.expiresAt).getTime() < Date.now()) {
    await admin.from("app_state").delete().eq("id", id);
    return { error: "Token expiré. Relancez depuis le dashboard." };
  }

  await admin.from("app_state").delete().eq("id", id);
  return payload;
}

export function getAppOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim()?.replace(/^/, "https://") ||
    "http://localhost:3000"
  );
}

export function getAnthropicApiKey(): string | undefined {
  return (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.ENGINE_ANTHROPIC_API_KEY?.trim() ||
    undefined
  );
}
