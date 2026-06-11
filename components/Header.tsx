"use client";

import { useState } from "react";
import Link from "next/link";
import BrandName from "./BrandName";

const links = [
  { href: "#", label: "Démo" },
  { href: "#fonctionnement", label: "Fonctionnement" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#faq", label: "FAQ" },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="header">
      <Link className="brand" href="/" onClick={() => setOpen(false)}>
        <span className="brand__logo brand__logo--img">
          <img src="/logo.png" alt="JEAN PAUL" width={156} height={156} />
        </span>
        <BrandName />
      </Link>

      <nav className="nav nav--desktop">
        {links.slice(0, 3).map((link) => (
          <Link key={link.label} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="header__actions">
        <Link href="/login" className="btn btn--outline btn--sm header__login-btn">
          Connexion
        </Link>
        <Link href="/onboarding?plan=pro" className="btn btn--outline btn--sm header__cta-btn">
          Démarrer
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
          <Link
            href="/onboarding?plan=pro"
            className="btn btn--outline btn--sm nav--mobile__cta"
            onClick={() => setOpen(false)}
          >
            Démarrer
          </Link>
        </nav>
      )}
    </header>
  );
}
