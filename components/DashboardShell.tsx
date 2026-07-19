"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import BrandName from "@/components/BrandName";
import AnonymousSaveModal from "@/components/AnonymousSaveModal";
import { isAnonymousSession } from "@/lib/auth-user";

const PRIMARY_NAV = [
  { href: "/dashboard", label: "Tableau de bord", mobileLabel: "Tableau", mobileIcon: "⌂", exact: true },
  { href: "/dashboard/preferences", label: "Critères", mobileLabel: "Critères", mobileIcon: "⚙" },
];

const SECONDARY_NAV = [
  { href: "/dashboard/facturation", label: "Facturation", mobileLabel: "Facture", mobileIcon: "€" },
  { href: "/dashboard/idees", label: "Boîte à idées", mobileLabel: "Idées", mobileIcon: "✦" },
  { href: "/dashboard/parrainage", label: "Parrainage", mobileLabel: "Parrain", mobileIcon: "%" },
  {
    href: "/dashboard/aide",
    label: "Aide",
    mobileLabel: "Aide",
    mobileIcon: "?",
    muted: true,
    desktopOnly: true,
  },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { uid, loading, user } = useAuth();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveIntent, setSaveIntent] = useState<"logout" | "leave">("leave");
  const isAnonymous = isAnonymousSession(user);

  const isReferralPage = pathname.startsWith("/dashboard/parrainage");

  useEffect(() => {
    if (loading || !uid) return;
    if (isReferralPage) return;
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("trial_used") === "1"
    ) {
      return;
    }

    const supabase = createClient();
    supabase
      .from("profiles")
      .select("onboarding_done, subscription_status")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.onboarding_done) {
          router.replace("/onboarding");
          return;
        }
        const active =
          data.subscription_status === "active" ||
          data.subscription_status === "trialing" ||
          data.subscription_status === "trial";
        if (!active) router.replace("/subscribe");
      });
  }, [router, uid, loading, isReferralPage]);

  // Compte déjà lié (e-mail) mais JWT encore anonyme → finaliser côté Auth.
  useEffect(() => {
    if (loading || !user?.is_anonymous || !user.email) return;
    let cancelled = false;
    (async () => {
      await fetch("/api/auth/finalize-anon", { method: "POST" }).catch(() => null);
      if (cancelled) return;
      const supabase = createClient();
      await supabase.auth.refreshSession();
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user?.id, user?.is_anonymous, user?.email]);

  const logout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }, [router]);

  function requestLogout() {
    if (isAnonymous) {
      setSaveIntent("logout");
      setSaveOpen(true);
      return;
    }
    void logout();
  }

  return (
    <div className="db">
      <div className="bg-decor" aria-hidden="true" />
      <div className="db-layout">
        <header className="db-topbar">
          <Link href="/" className="db__brand db__brand--mobile">
            <span className="brand__logo brand__logo--img brand__logo--side">
              <img src="/logo.png" alt="" width={32} height={32} />
            </span>
            <BrandName />
          </Link>
        </header>
        <aside className="db-side">
          <Link href="/" className="db__brand db__brand--side">
            <span className="brand__logo brand__logo--img brand__logo--side">
              <img src="/logo.png" alt="" width={30} height={30} />
            </span>
            <BrandName />
          </Link>
          <nav className="db-nav" aria-label="Navigation dashboard">
            {PRIMARY_NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`db-nav__link ${active ? "is-active" : ""}`}
                  data-tour={
                    item.href === "/dashboard/preferences" ? "prefs-link" : undefined
                  }
                >
                  <span className="db-nav__icon" aria-hidden="true">
                    {item.mobileIcon}
                  </span>
                  <span className="db-nav__label db-nav__label--full">{item.label}</span>
                  <span className="db-nav__label db-nav__label--short">{item.mobileLabel}</span>
                </Link>
              );
            })}
            <div className="db-nav__divider" aria-hidden="true" />
            {SECONDARY_NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "db-nav__link",
                    "db-nav__link--secondary",
                    item.muted ? "db-nav__link--muted" : "",
                    item.desktopOnly ? "db-nav__aide" : "",
                    active ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="db-nav__icon" aria-hidden="true">
                    {item.mobileIcon}
                  </span>
                  <span className="db-nav__label db-nav__label--full">{item.label}</span>
                  <span className="db-nav__label db-nav__label--short">{item.mobileLabel}</span>
                </Link>
              );
            })}
          </nav>
          <div className="db-side__foot">
            <Link
              href="/dashboard/compte"
              className={`db-nav__link db-nav__account ${pathname.startsWith("/dashboard/compte") ? "is-active" : ""}`}
            >
              <span className="db-nav__avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                  <circle cx="12" cy="8" r="3.4" fill="currentColor" />
                  <path
                    d="M5 19.2c0-3.2 3.1-5.2 7-5.2s7 2 7 5.2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </span>
              <span className="db-nav__label db-nav__label--full">Mon compte</span>
              <span className="db-nav__label db-nav__label--short">Compte</span>
            </Link>
            <button type="button" className="db-nav__link db-nav__logout" onClick={requestLogout}>
              Déconnexion
            </button>
          </div>
        </aside>
        <div className="db-content">{children}</div>
      </div>
      <AnonymousSaveModal
        open={saveOpen}
        intent={saveIntent}
        onClose={() => setSaveOpen(false)}
        onDiscard={
          saveIntent === "logout"
            ? () => {
                setSaveOpen(false);
                void logout();
              }
            : undefined
        }
      />
    </div>
  );
}
