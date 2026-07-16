"use client";

import Link from "next/link";
import { planQuery } from "@/lib/plans";
import { trackEvent } from "@/lib/umami";

export default function FinalCta() {
  return (
    <section className="section">
      <div className="container">
        <div className="finalcta">
          <h2>Plus de candidatures utiles, plus d&apos;entretiens.</h2>
          <p>
            En quelques clics, vos dossiers sont prêts et calibrés pour passer les filtres IA des recruteurs.
          </p>
          <Link
            href={`/onboarding${planQuery("test")}`}
            className="btn btn--cta btn--lg"
            onClick={() =>
              trackEvent("landing_cta_click", {
                source: "final_cta",
                plan: "test",
                cta_label: "Démarrer en 2 minutes",
              })
            }
          >
            Démarrer en 2 minutes
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
