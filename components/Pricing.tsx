"use client";

import Link from "next/link";
import {
  FREE_DISCOVERY_OFFER,
  displayPrice,
  PLANS_LIST,
  planQuery,
  type PlanId,
} from "@/lib/plans";
import { trackEvent } from "@/lib/umami";

export default function Pricing() {
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

        <div className="pricing__grid">
          <article className="pricing-card pricing-card--featured">
            <span className="pricing-card__badge">Pour démarrer</span>

            <h3 className="pricing-card__title">{FREE_DISCOVERY_OFFER.name}</h3>
            <p className="pricing-card__tagline">{FREE_DISCOVERY_OFFER.tagline}</p>

            <div className="pricing-card__price">
              <strong>{FREE_DISCOVERY_OFFER.priceLabel}</strong>
              <span>{FREE_DISCOVERY_OFFER.priceSuffix}</span>
            </div>

            <div className="pricing-card__savings-slot" />

            <p className="pricing-card__desc">{FREE_DISCOVERY_OFFER.description}</p>

            <div className="pricing-card__cta-wrap">
              <Link
                href={FREE_DISCOVERY_OFFER.href}
                className="btn pricing-card__cta btn--accent"
                onClick={() =>
                  trackEvent("pricing_plan_click", {
                    plan: FREE_DISCOVERY_OFFER.id,
                    billing: "free",
                    source: "landing_pricing",
                    cta_label: FREE_DISCOVERY_OFFER.cta,
                  })
                }
              >
                {FREE_DISCOVERY_OFFER.cta}
              </Link>
            </div>

            <ul className="pricing-card__features">
              {FREE_DISCOVERY_OFFER.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </article>

          {PLANS_LIST.map((plan) => {
            const price = displayPrice(plan, "weekly");
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

                <div className="pricing-card__savings-slot" />

                <p className="pricing-card__desc">{plan.description}</p>

                <div className="pricing-card__cta-wrap">
                  <Link
                    href={`/onboarding${planQuery(plan.id as PlanId)}`}
                    className={`btn pricing-card__cta${plan.featured ? " btn--accent" : " btn--outline"}`}
                    onClick={() =>
                      trackEvent("pricing_plan_click", {
                        plan: plan.id,
                        billing: plan.kind === "subscription" ? "monthly" : "one_time",
                        source: "landing_pricing",
                        cta_label: `Choisir ${plan.name}`,
                      })
                    }
                  >
                    {plan.kind === "one_time" ? "Choisir l'offre Start" : `Choisir ${plan.name}`}
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
          <strong>Découverte</strong> : recherche, scoring et dossiers personnalisés.
          {" "}
          <strong>Start</strong> : {displayPrice(PLANS_LIST[0]).amount} €, 25 candidatures complètes envoyées pour vous.
          {" "}
          <strong>Essentiel</strong> : abonnement, résiliable à tout moment.
        </p>
      </div>
    </section>
  );
}
