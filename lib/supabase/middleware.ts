import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login";
  const isSignup = path === "/signup" || path.startsWith("/signup/");

  if (!user && path.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (user && isSignup) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .maybeSingle();

    const active =
      profile?.subscription_status === "active" || profile?.subscription_status === "trialing";
    if (active) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
  }

  if (user && path.startsWith("/dashboard")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_done, subscription_status, plan_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.onboarding_done) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }

    const active =
      profile.subscription_status === "active" || profile.subscription_status === "trialing";
    if (!active) {
      const url = request.nextUrl.clone();
      url.pathname = "/subscribe";
      if (profile.plan_id) url.searchParams.set("plan", profile.plan_id);
      return NextResponse.redirect(url);
    }
  }

  if (user && path.startsWith("/onboarding")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_done, subscription_status, plan_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.onboarding_done) {
      const active =
        profile.subscription_status === "active" || profile.subscription_status === "trialing";
      const url = request.nextUrl.clone();
      url.pathname = active ? "/dashboard" : "/subscribe";
      if (!active && profile.plan_id) url.searchParams.set("plan", profile.plan_id);
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
