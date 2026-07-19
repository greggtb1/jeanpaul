import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { trackAICrawlerRequest } from "@datafast/ai-crawl";
import { updateSession } from "@/lib/supabase/middleware";

const DATAFAST_WEBSITE_ID = "dfid_ZUk0ZJXBXT20zJb6gNBa2";
const PUBLIC_ORIGIN = "https://blowmyjob.fr";

function needsSession(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard") ||
    pathname === "/api/pipeline" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/subscribe") ||
    pathname === "/login" ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/auth/")
  );
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  // DataFast bot traffic — do not await; package uses waitUntil when available
  trackAICrawlerRequest(request, event, {
    websiteId: DATAFAST_WEBSITE_ID,
    publicOrigin: PUBLIC_ORIGIN,
    ...(process.env.DATAFAST_BOT_TOKEN
      ? { authToken: process.env.DATAFAST_BOT_TOKEN }
      : {}),
  });

  if (needsSession(request.nextUrl.pathname)) {
    return updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  // Keep robots.txt, llms.txt, and sitemaps trackable for crawlers.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
    "/api/pipeline",
    "/api/auth/:path*",
  ],
};
