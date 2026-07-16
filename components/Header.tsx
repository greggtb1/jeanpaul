"use client";

import { useState } from "react";
import Link from "next/link";
import BrandName from "./BrandName";
import { trackEvent } from "@/lib/umami";

const links = [
  { href: "/#fonctionnement", label: "Fonctionnement" },
  { href: "/#tarifs", label: "Tarifs" },
  { href: "/ambassadeur", label: "Ambassadeurs" },
  { href: "/#faq", label: "FAQ" },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="header">
      <Link className="brand" href="/" onClick={() => setOpen(false)}>
        <span className="brand__logo brand__logo--img">
          <img src="/logo.png" alt="BLOW MY JOB" width={156} height={156} />
        </span>
        <BrandName />
      </Link>

      <nav className="nav nav--desktop">
        {links.slice(0, 4).map((link) => (
          <Link key={link.label} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="header__actions">
        <Link href="/login" className="header__login-link">
          Connexion
        </Link>
        <Link
          href="/onboarding"
          className="btn btn--cta btn--sm header__cta-btn"
          onClick={() =>
            trackEvent("landing_cta_click", {
              source: "header_desktop",
              cta_label: "Commencer",
            })
          }
        >
          Commencer
        </Link>

        <button
          type="button"
          className="nav-toggle"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {open && (
        <nav className="nav nav--mobile">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Link href="/login" onClick={() => setOpen(false)}>
            Connexion
          </Link>
          <Link
            href="/onboarding"
            className="btn btn--cta btn--sm nav--mobile__cta"
            onClick={() => {
              setOpen(false);
              trackEvent("landing_cta_click", {
                source: "header_mobile",
                cta_label: "Commencer",
              });
            }}
          >
            Commencer
          </Link>
        </nav>
      )}
    </header>
  );
}
