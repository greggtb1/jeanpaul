"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import BrandName from "@/components/BrandName";
import DashboardOnboarding from "@/components/DashboardOnboarding";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", mobileLabel: "Tableau", exact: true },
  { href: "/dashboard/compte", label: "Mon compte", mobileLabel: "Compte" },
  { href: "/dashboard/facturation", label: "Facturation", mobileLabel: "Facture" },
  { href: "/dashboard/preferences", label: "Critères de recherche", mobileLabel: "Critères" },
  { href: "/dashboard/idees", label: "Boîte à idées", mobileLabel: "Idées" },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { uid, loading } = useAuth();

  useEffect(() => {
    if (loading || !uid) return;
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
          data.subscription_status === "active" || data.subscription_status === "trialing";
        if (!active) router.replace("/subscribe");
      });
  }, [router, uid, loading]);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="db">
      <div className="bg-decor" aria-hidden="true" />
      <div className="db-layout">
        <header className="db-topbar">
          <Link href="/" className="db__brand db__brand--mobile">
            <span className="brand__logo brand__logo--img brand__logo--side">
              <img src="/logo.png" alt="" width={156} height={156} />
            </span>
            <BrandName />
          </Link>
          <button type="button" className="db-topbar__logout" onClick={logout}>
            Déconnexion
          </button>
        </header>
        <aside className="db-side">
          <Link href="/" className="db__brand db__brand--side">
            <span className="brand__logo brand__logo--img brand__logo--side">
              <img src="/logo.png" alt="" width={156} height={156} />
            </span>
            <BrandName />
          </Link>
          <nav className="db-nav" aria-label="Navigation dashboard">
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`db-nav__link ${active ? "is-active" : ""}`}
                >
                  <span className="db-nav__label db-nav__label--full">{item.label}</span>
                  <span className="db-nav__label db-nav__label--short">{item.mobileLabel}</span>
                </Link>
              );
            })}
          </nav>
          <div className="db-side__foot">
            <button type="button" className="db-nav__link db-nav__logout" onClick={logout}>
              Déconnexion
            </button>
          </div>
        </aside>
        <div className="db-content">{children}</div>
      </div>
      <DashboardOnboarding userId={uid} />
    </div>
  );
}
