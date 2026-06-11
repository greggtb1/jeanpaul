import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/pipeline",
    "/api/auth/:path*",
    "/onboarding/:path*",
    "/subscribe/:path*",
    "/login",
    "/signup/:path*",
    "/auth/:path*",
  ],
};
