"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MONTHLY_DISCOUNT_PERCENT,
  displayPrice,
  PLANS_LIST,
  planQuery,
  type BillingInterval,
  type PlanId,
} from "@/lib/plans";

export default function Pricing() {
  const [billing, setBilling] = useState<BillingInterval>("weekly");

  return (
    <section className="section section--pricing" id="tarifs">
      <div className="container">
        <div className="section__head">
          <span className="eyebrow">Tarifs</span>
          <h2 className="section__title">Simple et accessible</h2>
          <p className="section__subtitle">
            Résiliable à tout moment sur les abonnements.
          </p>
        </div>

        <div className="pricing__billing-toggle" role="group" aria-label="Facturation">
          <button
            type="button"
            className={billing === "weekly" ? "is-active" : ""}
            onClick={() => setBilling("weekly")}
          >
            Hebdomadaire
          </button>
          <button
            type="button"
            className={billing === "monthly" ? "is-active" : ""}
            onClick={() => setBilling("monthly")}
          >
            Mensuel <span className="pricing__discount">−{MONTHLY_DISCOUNT_PERCENT} %</span>
          </button>
        </div>

        <div className="pricing__grid">
          {PLANS_LIST.map((plan) => {
            const price = displayPrice(plan, plan.kind === "one_time" ? "weekly" : billing);
            return (
              <article
                key={plan.id}
                className={`pricing-card${plan.featured ? " pricing-card--featured" : ""}`}
              >
                {plan.featured && (
                  <span className="pricing-card__badge">Le plus populaire</span>
                )}

                <h3 className="pricing-card__title">{plan.name}</h3>
                <p className="pricing-card__tagline">{plan.tagline}</p>

                <div className="pricing-card__price">
                  <strong>{price.amount} €</strong>
                  <span>{price.suffix}</span>
                </div>

                <div className="pricing-card__savings-slot">
                  {price.billingSavings && (
                    <p className="pricing-card__savings">{price.billingSavings}</p>
                  )}
                </div>

                <p className="pricing-card__desc">{plan.description}</p>

                <div className="pricing-card__cta-wrap">
                  <Link
                    href={`/onboarding${planQuery(plan.id as PlanId, plan.kind === "subscription" ? billing : undefined)}`}
                    className={`btn pricing-card__cta${plan.featured ? " btn--accent" : " btn--outline"}`}
                  >
                    Choisir {plan.name}
                  </Link>
                </div>

                <ul className="pricing-card__features">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>

        <p className="pricing__note">
          <strong>Découverte</strong> : paiement unique ({displayPrice(PLANS_LIST[0]).amount} €, 1 recherche complète jusqu&apos;à 15 dossiers prêts à soumettre).
          {" "}
          <strong>Essentiel</strong> et <strong>Intensif</strong> : abonnement hebdo ou mensuel (−{MONTHLY_DISCOUNT_PERCENT} %),
          résiliable à tout moment.
        </p>
      </div>
    </section>
  );
}
