"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import {
  CREDIT_PACKS_LIST,
  displayPrice,
  formatPriceEur,
  FREE_DISCOVERY_OFFER,
  getPlan,
  getBillingOfferPlans,
  monthlyPriceCents,
  parseBillingInterval,
  parsePlanId,
  planBadge,
  weeklyPriceCents,
  type BillingInterval,
  type CreditPackId,
  type PlanId,
} from "@/lib/plans";
import {
  countGeneratedJobs,
  countWeeklyGeneratedJobs,
  getQuotaUsage,
  isDiscoveryTrial,
} from "@/lib/plan-quota";
import type { SubscriptionInfo } from "@/app/api/stripe/subscription/route";
import { parseApiJson } from "@/lib/parse-api-json";
import { trackAdsPurchase } from "@/lib/gads";
import { trackEvent } from "@/lib/umami";
import CurrentDiscoveryPlanCard from "@/components/CurrentDiscoveryPlanCard";

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function fmtAmount(amount: number | null, currency: string | null) {
  if (amount == null) return null;
  const cur = (currency || "eur").toUpperCase();
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur }).format(
    amount / 100
  );
}

const STATUS_LABEL: Record<string, string> = {
  active: "Actif",
  trialing: "Essai",
  past_due: "En retard",
  canceled: "Résilié",
  none: "Actif",
};

export default function FacturationPage() {
  const searchParams = useSearchParams();
  const { uid } = useAuth();
  const upgradeRef = useRef<HTMLElement>(null);
  const creditsRef = useRef<HTMLElement>(null);

  const [loading, setLoading] = useState(true);
  const [planId, setPlanId] = useState(parsePlanId(null));
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [quotaUsage, setQuotaUsage] = useState<ReturnType<typeof getQuotaUsage> | null>(null);
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutPlanId, setCheckoutPlanId] = useState<PlanId | null>(null);
  const [checkoutPackId, setCheckoutPackId] = useState<CreditPackId | null>(null);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const showUpgrade = searchParams.get("upgrade") === "1";
  const showCredits = searchParams.get("credits") === "1";
  const suggestedPlanId = parsePlanId(searchParams.get("plan"));
  const sessionId = searchParams.get("session_id");
  const creditsSessionId = searchParams.get("credits_session");

  const [billing] = useState<BillingInterval>(
    parseBillingInterval(searchParams.get("billing"))
  );

  const emptySub = useCallback(
    (status: string | null, plan: string | null): SubscriptionInfo => ({
      status: status || "none",
      planId: plan,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      amount: null,
      currency: null,
      lastInvoiceDate: null,
      lastInvoiceAmount: null,
      lastInvoicePdfUrl: null,
      hasCustomer: false,
      mode: "none",
    }),
    []
  );

  const loadData = useCallback(async () => {
    if (!uid) return;
    const supabase = createClient();

    // 1) Profil d'abord → débloque l'UI (surtout en essai, sans Stripe).
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan_id, first_search_done, bonus_credits, subscription_status")
      .eq("id", uid)
      .maybeSingle();

    const profileStatus = profile?.subscription_status ?? null;
    const profilePlanId = parsePlanId(profile?.plan_id);
    setSubscriptionStatus(profileStatus);
    setPlanId(profilePlanId);

    const discovery = isDiscoveryTrial(profileStatus);
    // Débloque l'UI dès le profil — Stripe / jobs viennent enrichir ensuite.
    setSub(emptySub(profileStatus, profile?.plan_id ?? null));
    setLoading(false);

    // Jobs légers + Stripe seulement hors essai (évite un aller-retour Stripe inutile).
    const jobsPromise = supabase
      .from("jobs")
      .select("url,cv_url,fit_score,updated_at,data")
      .eq("user_id", uid)
      .eq("deleted", false);

    const stripePromise = discovery
      ? Promise.resolve(null as SubscriptionInfo | null)
      : fetch("/api/stripe/subscription")
          .then((r) => r.json() as Promise<SubscriptionInfo>)
          .catch(() => null);

    const [{ data: jobs }, subInfo] = await Promise.all([jobsPromise, stripePromise]);

    const effectivePlanId = parsePlanId(subInfo?.planId ?? profile?.plan_id);
    setPlanId(effectivePlanId);
    const plan = getPlan(effectivePlanId);
    setQuotaUsage(
      getQuotaUsage(
        plan,
        {
          generatedCount: countGeneratedJobs(jobs || []),
          weeklyGeneratedCount: countWeeklyGeneratedJobs(jobs || []),
          firstSearchDone: !!profile?.first_search_done,
          bonusCredits: profile?.bonus_credits ?? 0,
        },
        profileStatus
      )
    );
    if (subInfo) setSub(subInfo);
  }, [uid, emptySub]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!sessionId || !uid) return;
    fetch(`/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await parseApiJson<{
          active?: boolean;
          error?: string;
          amount_total_cents?: number | null;
          currency?: string | null;
          email?: string | null;
        }>(res);
        if (!res.ok) throw new Error(data.error || "Vérification échouée");
        if (data.active) {
          setFeedback({ type: "ok", text: "Plan mis à jour." });
          trackEvent("premium_activated", { plan: planId, source: "facturation" });
          trackAdsPurchase({
            value:
              typeof data.amount_total_cents === "number"
                ? data.amount_total_cents / 100
                : undefined,
            currency: (data.currency ?? "eur").toUpperCase(),
            transactionId: sessionId,
            email: data.email ?? undefined,
          });
          await loadData();
        }
      })
      .catch((e) => setFeedback({ type: "err", text: (e as Error).message }));
  }, [sessionId, uid, loadData]);

  useEffect(() => {
    if (searchParams.get("upgraded") === "1" && !sessionId) {
      setFeedback({ type: "ok", text: "Plan mis à jour." });
      trackEvent("premium_activated", { plan: planId, source: "facturation" });
    }
  }, [searchParams, sessionId, planId]);

  useEffect(() => {
    if (!creditsSessionId || !uid) return;
    fetch(`/api/stripe/credits/verify?session_id=${encodeURIComponent(creditsSessionId)}`)
      .then(async (res) => {
        const data = await parseApiJson<{
          paid?: boolean;
          credits?: number;
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(data.error || "Vérification échouée");
        if (data.paid) {
          setFeedback({
            type: "ok",
            text: `${data.credits} dossiers ajoutés.`,
          });
          await loadData();
        }
      })
      .catch((e) => setFeedback({ type: "err", text: (e as Error).message }));
  }, [creditsSessionId, uid, loadData]);

  useEffect(() => {
    if (loading) return;
    const target = showCredits ? creditsRef.current : showUpgrade ? upgradeRef.current : null;
    if (!target) return;
    const t = setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => clearTimeout(t);
  }, [showUpgrade, showCredits, loading]);

  const isDiscovery = isDiscoveryTrial(subscriptionStatus);
  const offerPlans = useMemo(
    () => getBillingOfferPlans(planId, isDiscovery),
    [planId, isDiscovery]
  );

  async function openPortal() {
    setFeedback(null);
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      window.location.href = data.url;
    } catch (e) {
      setFeedback({ type: "err", text: (e as Error).message });
      setPortalLoading(false);
    }
  }

  async function startUpgrade(targetPlanId: PlanId) {
    setCheckoutPlanId(targetPlanId);
    setFeedback(null);
    const targetPlan = getPlan(targetPlanId);
    const selectedBilling =
      targetPlan.kind !== "subscription"
        ? "weekly"
        : targetPlan.priceMonthlyEur != null
          ? "monthly"
          : billing;
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: targetPlanId, billing: selectedBilling, upgrade: true }),
      });
      const data = await parseApiJson<{
        url?: string;
        error?: string;
        upgraded?: boolean;
      }>(res);
      if (!res.ok) throw new Error(data.error || "Impossible de lancer le paiement");
      if (data.url) {
        if (data.upgraded) {
          setFeedback({ type: "ok", text: "Plan mis à jour." });
          setPlanId(targetPlanId);
          await loadData();
          setCheckoutPlanId(null);
          return;
        }
        window.location.href = data.url;
      } else {
        throw new Error("URL de paiement manquante");
      }
    } catch (e) {
      setFeedback({ type: "err", text: (e as Error).message });
      setCheckoutPlanId(null);
    }
  }

  async function buyCredits(packId: CreditPackId) {
    setCheckoutPackId(packId);
    setFeedback(null);
    try {
      const res = await fetch("/api/stripe/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: packId }),
      });
      const data = await parseApiJson<{ url?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Impossible de lancer le paiement");
      if (!data.url) throw new Error("URL de paiement manquante");
      window.location.href = data.url;
    } catch (e) {
      setFeedback({ type: "err", text: (e as Error).message });
      setCheckoutPackId(null);
    }
  }

  const plan = getPlan(planId);
  const displayPlanName = isDiscovery ? FREE_DISCOVERY_OFFER.name : plan.name;
  const priceBilling =
    sub?.mode === "one_time"
      ? "weekly"
      : sub?.mode === "subscription" && sub.amount != null && plan.priceWeeklyEur != null
        ? Math.abs(sub.amount - monthlyPriceCents(plan.priceWeeklyEur)) <
          Math.abs(sub.amount - weeklyPriceCents(plan))
          ? "monthly"
          : "weekly"
        : parseBillingInterval(null);
  const price = isDiscovery
    ? { amount: "0", suffix: "" }
    : sub?.mode === "one_time"
      ? displayPrice(getPlan("test"), "weekly")
      : displayPrice(plan, priceBilling);
  const isPeriodic = sub?.mode === "subscription";
  const canManage = !!sub?.hasCustomer;
  const isCancelling = sub?.cancelAtPeriodEnd && !sub?.cancelAt;
  const statusLabel = isDiscovery
    ? "Essai gratuit"
    : STATUS_LABEL[sub?.status || "active"] ?? sub?.status ?? "Actif";

  const renewalLine = (() => {
    if (loading || !sub) return null;
    if (isDiscovery) return "Gratuit · sans engagement";
    if (isPeriodic && sub.currentPeriodEnd && sub.status !== "canceled" && !sub.cancelAt) {
      return isCancelling
        ? `Jusqu'au ${fmtDate(sub.currentPeriodEnd)}`
        : `Renouvellement ${fmtDate(sub.currentPeriodEnd)}`;
    }
    if (sub.cancelAt) return `Fin ${fmtDate(sub.cancelAt)}`;
    if (!isPeriodic) return "Paiement unique";
    return null;
  })();

  const quotaPct =
    quotaUsage && quotaUsage.limit > 0
      ? Math.min(
          100,
          Math.round(
            (quotaUsage.used / (quotaUsage.weeklyLimit ?? quotaUsage.limit)) * 100
          )
        )
      : 0;

  return (
    <main className="db__main db__main--narrow fact-page">
      <header className="fact-page__head">
        <h1>Facturation</h1>
      </header>

      {feedback && (
        <p className={`fact-page__flash fact-page__flash--${feedback.type}`} role="status">
          {feedback.text}
        </p>
      )}

      <section className="fact-sheet">
        {loading ? (
          <p className="fact-page__muted">Chargement…</p>
        ) : (
          <>
            <div className="fact-sheet__hero">
              <div>
                <p className="fact-sheet__label">Votre formule</p>
                <h2 className="fact-sheet__plan">{displayPlanName}</h2>
                {renewalLine && <p className="fact-page__muted">{renewalLine}</p>}
              </div>
              <div className="fact-sheet__price-block">
                <span className="fact-sheet__status">{statusLabel}</span>
                <p className="fact-sheet__price">
                  {price.amount} €{price.suffix && <span> {price.suffix}</span>}
                </p>
              </div>
            </div>

            {quotaUsage && (
              <div className="fact-sheet__quota">
                <div className="fact-sheet__quota-top">
                  <span>{quotaUsage.label}</span>
                  <span>
                    {quotaUsage.used}/{quotaUsage.limit}
                    {quotaUsage.bonusCredits > 0 && ` (+${quotaUsage.bonusCredits})`}
                  </span>
                </div>
                <div className="fact-sheet__bar" aria-hidden="true">
                  <span style={{ width: `${quotaPct}%` }} />
                </div>
              </div>
            )}

            <div className="fact-sheet__foot">
              {sub?.lastInvoiceDate && (
                <p className="fact-page__muted">
                  Dernier paiement · {fmtDate(sub.lastInvoiceDate)}
                  {fmtAmount(sub.lastInvoiceAmount, sub.currency) &&
                    ` · ${fmtAmount(sub.lastInvoiceAmount, sub.currency)}`}
                </p>
              )}
              {canManage && (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={openPortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? "Ouverture…" : "Factures & paiement"}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {!loading && offerPlans.length > 0 && (
        <section
          ref={upgradeRef}
          className={`fact-sheet fact-upgrade${showUpgrade ? " fact-sheet--focus fact-upgrade--highlight" : ""}`}
        >
          <div className="fact-upgrade__head">
            {isDiscovery && <p className="fact-upgrade__eyebrow">Débloquer la suite</p>}
            <h3>{isDiscovery ? "Choisissez votre formule" : "Changer de formule"}</h3>
            {!isDiscovery && (
              <p className="fact-upgrade__lead">
                Besoin de plus de dossiers inclus ? Passez à une formule supérieure.
              </p>
            )}
          </div>

          <div className="fact-upgrade__grid">
            {isDiscovery && <CurrentDiscoveryPlanCard />}
            {offerPlans.map((p) => {
              const pPrice = displayPrice(p, p.kind === "one_time" ? "weekly" : billing);
              const busy = checkoutPlanId !== null;
              const isLoading = checkoutPlanId === p.id;
              const isSuggested = p.id === suggestedPlanId;
              const badge = planBadge(p);

              return (
                <article
                  key={p.id}
                  className={`pricing-card fact-upgrade__card${p.featured ? " pricing-card--featured" : ""}${isSuggested ? " fact-upgrade__card--suggested" : ""}`}
                >
                  <p className="pricing-card__tagline">{p.tagline}</p>
                  <div className="pricing-card__name-row">
                    <h4 className="pricing-card__title">{p.name}</h4>
                    {badge ? <span className="pricing-card__label">{badge}</span> : null}
                    {isSuggested && !p.featured && p.kind !== "one_time" ? (
                      <span className="pricing-card__label pricing-card__label--suggested">
                        Suggéré
                      </span>
                    ) : null}
                  </div>

                  <div className="pricing-card__price">
                    <strong>{pPrice.amount} €</strong>
                    <span>{pPrice.suffix}</span>
                  </div>

                  <div className="pricing-card__savings-slot" />

                  <p className="pricing-card__desc">{p.description}</p>

                  <div className="pricing-card__cta-wrap">
                    <button
                      type="button"
                      className={`btn pricing-card__cta${p.featured ? " btn--accent" : " btn--outline"}`}
                      disabled={busy || loading}
                      onClick={() => startUpgrade(p.id)}
                    >
                      {isLoading
                        ? "Redirection…"
                        : p.kind === "one_time"
                          ? "Passer à Start"
                          : `Passer à ${p.name}`}
                    </button>
                  </div>

                  <ul className="pricing-card__features">
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>

        </section>
      )}

      {!loading && !isDiscovery && (
        <section
          ref={creditsRef}
          className={`fact-sheet fact-credits${showCredits ? " fact-sheet--focus" : ""}`}
        >
          <div className="fact-credits__head">
            <div>
              <p className="fact-credits__eyebrow">Option complémentaire</p>
              <h3 className="fact-credits__title">Ajouter des dossiers</h3>
              <p className="fact-credits__lead">
                Quelques dossiers en plus, sans changer de formule.
              </p>
              {quotaUsage && quotaUsage.bonusCredits > 0 && (
                <p className="fact-page__muted fact-page__bonus">
                  {quotaUsage.bonusCredits} bonus restant
                  {quotaUsage.bonusCredits > 1 ? "s" : ""}
                </p>
              )}
            </div>
            {quotaUsage && quotaUsage.bonusCredits > 0 && (
              <span className="fact-credits__balance">
                <strong>{quotaUsage.bonusCredits}</strong> bonus
              </span>
            )}
          </div>

          <div className="fact-credits__grid">
            {CREDIT_PACKS_LIST.map((pack) => {
              const busy = checkoutPackId !== null;
              const isLoading = checkoutPackId === pack.id;
              return (
                <div
                  key={pack.id}
                  className={`fact-credits__card${pack.featured ? " fact-credits__card--featured" : ""}`}
                >
                  {pack.featured && (
                    <span className="fact-credits__badge">Populaire</span>
                  )}
                  <span className="fact-credits__count">{pack.credits}</span>
                  <span className="fact-credits__label">dossiers</span>
                  <span className="fact-credits__hint">{pack.hint}</span>
                  <span className="fact-credits__price">{formatPriceEur(pack.priceEur)} €</span>
                  <button
                    type="button"
                    className="btn btn--outline btn--sm fact-credits__cta"
                    disabled={busy || loading}
                    onClick={() => buyCredits(pack.id)}
                  >
                    {isLoading ? "…" : "Acheter"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
