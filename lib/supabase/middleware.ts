import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const REFERRAL_COOKIE = "aiapply_ref_s";

function appendRefToSubscribeUrl(url: URL, request: NextRequest) {
  const ref = request.cookies.get(REFERRAL_COOKIE)?.value?.trim();
  if (ref && !url.searchParams.has("ref")) url.searchParams.set("ref", ref);
}

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
  const isAffiliateSignup = path === "/signup-affiliate";
  const isSignup =
    path === "/signup" ||
    path.startsWith("/signup/") ||
    path === "/signup-affiliate";

  if (!user && path.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Un utilisateur anonyme (essai en cours) doit pouvoir accéder à /login pour
  // se connecter à un vrai compte : on ne le renvoie pas vers le dashboard.
  if (user && !user.is_anonymous && isAuthPage) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = next?.startsWith("/dashboard") ? next : "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && isAffiliateSignup) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard/parrainage";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const isSubscribe = path === "/subscribe" || path.startsWith("/subscribe/");
  const isReferralDashboard = path === "/dashboard/parrainage";
  // Vue "essai déjà utilisé" : on laisse toujours atteindre le dashboard (flouté +
  // blocage), sans rebondir vers l'onboarding ou l'abonnement.
  const isTrialUsedView =
    path === "/dashboard" && request.nextUrl.searchParams.get("trial_used") === "1";

  // Un utilisateur anonyme (mode essai) doit pouvoir finaliser /signup ou payer sur /subscribe
  if (user && !user.is_anonymous && (isSignup || isSubscribe) && !path.startsWith("/subscribe/success")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status, onboarding_done")
      .eq("id", user.id)
      .maybeSingle();

    const active =
      profile?.subscription_status === "active" || profile?.subscription_status === "trialing";
    if (active) {
      const url = request.nextUrl.clone();
      // S'il reste à finir l'onboarding, on l'y renvoie plutôt qu'au dashboard
      url.pathname = profile?.onboarding_done ? "/dashboard" : "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  if (user && path.startsWith("/dashboard") && !isReferralDashboard && !isTrialUsedView) {
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
      profile.subscription_status === "active" ||
      profile.subscription_status === "trialing" ||
      profile.subscription_status === "trial";
    if (!active) {
      const url = request.nextUrl.clone();
      url.pathname = "/subscribe";
      if (profile.plan_id) url.searchParams.set("plan", profile.plan_id);
      appendRefToSubscribeUrl(url, request);
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
        profile.subscription_status === "active" ||
        profile.subscription_status === "trialing" ||
        profile.subscription_status === "trial";
      const url = request.nextUrl.clone();
      url.pathname = active ? "/dashboard" : "/subscribe";
      if (!active && profile.plan_id) url.searchParams.set("plan", profile.plan_id);
      if (!active) appendRefToSubscribeUrl(url, request);
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
