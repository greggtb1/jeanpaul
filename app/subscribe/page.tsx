"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import BrandName from "@/components/BrandName";
import {
  MONTHLY_DISCOUNT_PERCENT,
  displayPrice,
  parseBillingInterval,
  parsePlanId,
  PLANS_LIST,
  type BillingInterval,
  type PlanId,
} from "@/lib/plans";
import { getOrCreateDraftId, loadDraft, saveDraft } from "@/lib/onboarding-draft";
import { parseApiJson } from "@/lib/parse-api-json";

export default function SubscribePage() {
  const searchParams = useSearchParams();
  const [loadingPlanId, setLoadingPlanId] = useState<PlanId | null>(null);
  const [error, setError] = useState("");

  const cancelled = searchParams.get("cancelled") === "1";

  const initialPlanId = parsePlanId(searchParams.get("plan"));
  const [billing, setBilling] = useState<BillingInterval>(
    parseBillingInterval(searchParams.get("billing"))
  );

  async function subscribe(planId: PlanId) {
    setLoadingPlanId(planId);
    setError("");
    try {
      const plan = PLANS_LIST.find((p) => p.id === planId)!;
      const isSubscription = plan.kind === "subscription";

      const current = saveDraft({
        ...(loadDraft() ?? {}),
        plan_id: planId,
        draft_id: getOrCreateDraftId(),
      });

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planId,
          billing: isSubscription ? billing : undefined,
          email: current.email || undefined,
          full_name: current.full_name || undefined,
          draft_id: current.draft_id,
        }),
      });
      const data = await parseApiJson<{ url?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Impossible de lancer le paiement");
      if (data.url) window.location.href = data.url;
      else throw new Error("URL de paiement manquante");
    } catch (e) {
      setError((e as Error).message);
      setLoadingPlanId(null);
    }
  }

  return (
    <div className="paywall-page">
      <div className="bg-decor" aria-hidden="true" />
      <div className="paywall-card paywall-card--plans">
        <div className="paywall-card__brand">
          <img src="/logo.png" alt="" width={48} height={48} />
          <BrandName />
        </div>
        <span className="paywall-card__badge">Étape 2 sur 3</span>
        <h1>Choisissez votre formule</h1>

        <div className="paywall-card__billing" role="group" aria-label="Facturation">
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

        <div className="pricing__grid paywall-card__plans">
          {PLANS_LIST.map((plan) => {
            const price = displayPrice(
              plan,
              plan.kind === "one_time" ? "weekly" : billing
            );
            const loading = loadingPlanId === plan.id;
            const busy = loadingPlanId !== null;

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
                  <button
                    type="button"
                    className="btn btn--outline pricing-card__cta"
                    disabled={busy}
                    onClick={() => subscribe(plan.id)}
                  >
                    {loading ? "Redirection…" : `Choisir ${plan.name}`}
                  </button>
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

        {cancelled && (
          <p className="paywall-card__warn">Paiement annulé. Vous pouvez réessayer quand vous voulez.</p>
        )}
        {error && <p className="paywall-card__error">{error}</p>}
        <p className="paywall-card__foot">
          Paiement sécurisé par Stripe · création de compte juste après
        </p>
      </div>
    </div>
  );
}
