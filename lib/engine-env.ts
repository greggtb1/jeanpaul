/** Variables d'environnement pour le moteur Python (service role requis). */
export function getEngineServiceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
}

export function buildEngineSpawnEnv(userId: string, runId: string): NodeJS.ProcessEnv {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    "";
  const serviceKey = getEngineServiceKey();

  return {
    ...process.env,
    SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SUPABASE_KEY: serviceKey || process.env.SUPABASE_KEY,
    JA_USER_ID: userId,
    JA_RUN_ID: runId,
  };
}
