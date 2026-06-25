import { cookies } from "next/headers";

/**
 * DataFast cookies to forward into Stripe Checkout metadata
 * for revenue attribution.
 */
export async function datafastAttributionMetadata(): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const visitorId = cookieStore.get("datafast_visitor_id")?.value?.trim();
  const sessionId = cookieStore.get("datafast_session_id")?.value?.trim();

  const metadata: Record<string, string> = {};
  if (visitorId) metadata.datafast_visitor_id = visitorId;
  if (sessionId) metadata.datafast_session_id = sessionId;
  return metadata;
}
