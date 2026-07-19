"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PLANS_LIST, displayPrice } from "@/lib/plans";
import { trackEvent } from "@/lib/umami";

/**
 * Blocage "essai découverte déjà utilisé" : posé par-dessus le dashboard ou la
 * fin de l'onboarding, avec message clair et les deux formules pour continuer.
 */
export default function TrialUsedBlock({ source }: { source: string }) {
  useEffect(() => {
    trackEvent("trial_used_block_shown", { source });
    document.body.classList.add("trial-used-lock");
    return () => document.body.classList.remove("trial-used-lock");
  }, [source]);

  return (
    <div
      className="trial-used__overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-used-title"
    >
      <div className="trial-used">
        <span className="trial-used__badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Essai découverte déjà utilisé
        </span>
        <h2 id="trial-used-title" className="trial-used__title">
          Vous avez déjà profité de votre essai gratuit
        </h2>
        <p className="trial-used__text">
          Un seul essai découverte est offert. Pour lancer de nouvelles recherches et
          débloquer vos CV et lettres, choisissez l&apos;une de ces deux formules.
        </p>
        <div className="trial-used__plans">
          {PLANS_LIST.map((plan) => {
            const price = displayPrice(plan);
            const href = `/dashboard/facturation?upgrade=1&plan=${plan.id}`;
            return (
              <div
                key={plan.id}
                className={`trial-used__plan${plan.featured ? " trial-used__plan--featured" : ""}`}
              >
                {plan.featured && (
                  <span className="trial-used__plan-flag">Populaire</span>
                )}
                <p className="trial-used__plan-tagline">{plan.tagline}</p>
                <h3 className="trial-used__plan-name">{plan.name}</h3>
                <p className="trial-used__plan-price">
                  <strong>{price.amount} €</strong> <span>{price.suffix}</span>
                </p>
                <Link
                  href={href}
                  className={`btn ${plan.featured ? "btn--coral" : "btn--ghost"} trial-used__plan-cta`}
                  onClick={() => trackEvent("trial_used_block_cta_clicked", { plan: plan.id, source })}
                >
                  {`Passer à ${plan.name}`}
                </Link>
                <ul className="trial-used__plan-feats">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
