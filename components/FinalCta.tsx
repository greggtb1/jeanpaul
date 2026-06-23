"use client";

import Link from "next/link";
import { planQuery } from "@/lib/plans";
import { trackEvent } from "@/lib/umami";

export default function FinalCta() {
  return (
    <section className="section">
      <div className="container">
        <div className="finalcta">
          <h2>Laissez Blow My Job faire le sale boulot.</h2>
          <p>
            Vous validez, le reste est automatisé.
          </p>
          <Link
            href={`/onboarding${planQuery("test")}`}
            className="btn btn--outline btn--lg"
            onClick={() => trackEvent("landing_cta_click", { source: "final_cta", plan: "test" })}
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
