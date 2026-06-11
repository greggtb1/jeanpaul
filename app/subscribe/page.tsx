"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandName from "@/components/BrandName";
import { getPlan, LAUNCH_PRICE_EUR, parsePlanId } from "@/lib/plans";
import { getOrCreateDraftId, loadDraft, saveDraft } from "@/lib/onboarding-draft";
import { parseApiJson } from "@/lib/parse-api-json";

export default function SubscribePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const cancelled = searchParams.get("cancelled") === "1";
  const plan = getPlan(searchParams.get("plan"));

  useEffect(() => {
    const current = loadDraft();
    if (!current?.email) {
      router.replace(`/onboarding?plan=${plan.id}`);
      return;
    }
    setDraftEmail(current.email);
  }, [router, plan.id]);

  async function subscribe() {
    setLoading(true);
    setError("");
    try {
      const current = saveDraft({
        ...(loadDraft() ?? {}),
        plan_id: plan.id,
        draft_id: getOrCreateDraftId(),
      });

      if (!current.email?.trim()) {
        router.replace(`/onboarding?plan=${plan.id}`);
        return;
      }

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.id,
          email: current.email,
          full_name: current.full_name,
          draft_id: current.draft_id,
        }),
      });
      const data = await parseApiJson<{ url?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Impossible de lancer le paiement");
      if (data.url) window.location.href = data.url;
      else throw new Error("URL de paiement manquante");
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="paywall-page">
      <div className="bg-decor" aria-hidden="true" />
      <div className="paywall-card">
        <div className="paywall-card__brand">
          <img src="/logo.png" alt="" width={48} height={48} />
          <BrandName />
        </div>
        <span className="paywall-card__badge">Étape 2 sur 3</span>
        <h1>Plan {plan.name}</h1>
        <p className="paywall-card__lead">{plan.description}</p>
        {draftEmail && (
          <p className="paywall-card__lead">
            Compte à créer après paiement : <strong>{draftEmail}</strong>
          </p>
        )}
        <ul className="paywall-card__features">
          {plan.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <div className="paywall-card__price">
          <span className="paywall-card__price-old">{plan.listPrice} €</span>
          <strong>{LAUNCH_PRICE_EUR} €</strong>
          <span> une fois</span>
        </div>
        <p className="paywall-card__launch-note">
          Offre lancement : paiement unique (pas d&apos;abonnement pour l&apos;instant).
        </p>
        {cancelled && (
          <p className="paywall-card__warn">Paiement annulé. Vous pouvez réessayer quand vous voulez.</p>
        )}
        {error && <p className="paywall-card__error">{error}</p>}
        <button
          type="button"
          className="btn btn--coral btn--full"
          disabled={loading}
          onClick={subscribe}
        >
          {loading ? "Redirection vers Stripe…" : `Payer ${LAUNCH_PRICE_EUR} €`}
        </button>
        <p className="paywall-card__foot">
          Paiement sécurisé par Stripe · création de compte juste après
          <br />
          <span className="paywall-card__promo-hint">
            Code promo <strong>greg</strong> = gratuit, sans carte bancaire
          </span>
        </p>
      </div>
    </div>
  );
}
