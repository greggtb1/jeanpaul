"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import {
  CREDIT_PACKS_LIST,
  MONTHLY_DISCOUNT_PERCENT,
  applicationsQuotaLabel,
  displayPrice,
  formatPriceEur,
  getPlan,
  getUpgradePlans,
  monthlyPriceCents,
  parseBillingInterval,
  parsePlanId,
  weeklyPriceCents,
  type BillingInterval,
  type CreditPackId,
  type PlanId,
} from "@/lib/plans";
import {
  countGeneratedJobs,
  countWeeklyGeneratedJobs,
  getQuotaUsage,
} from "@/lib/plan-quota";
import type { SubscriptionInfo } from "@/app/api/stripe/subscription/route";
import { parseApiJson } from "@/lib/parse-api-json";

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
  const supabase = createClient();
  const upgradeRef = useRef<HTMLElement>(null);
  const creditsRef = useRef<HTMLElement>(null);

  const [loading, setLoading] = useState(true);
  const [planId, setPlanId] = useState(parsePlanId(null));
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

  const [billing, setBilling] = useState<BillingInterval>(
    parseBillingInterval(searchParams.get("billing"))
  );

  const loadData = useCallback(async () => {
    if (!uid) return;
    const [profileRes, jobsRes, subRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("plan_id, first_search_done, bonus_credits")
        .eq("id", uid)
        .maybeSingle(),
      supabase
        .from("jobs")
        .select("url,cv_url,fit_score,data,updated_at")
        .eq("user_id", uid)
        .eq("deleted", false),
      fetch("/api/stripe/subscription").then((r) => r.json()),
    ]);
    const subInfo = subRes as SubscriptionInfo;
    const effectivePlanId = parsePlanId(subInfo.planId ?? profileRes.data?.plan_id);
    setPlanId(effectivePlanId);
    const jobs = jobsRes.data || [];
    const plan = getPlan(effectivePlanId);
    setQuotaUsage(
      getQuotaUsage(plan, {
        generatedCount: countGeneratedJobs(jobs),
        weeklyGeneratedCount: countWeeklyGeneratedJobs(jobs),
        firstSearchDone: !!profileRes.data?.first_search_done,
        bonusCredits: profileRes.data?.bonus_credits ?? 0,
      })
    );
    setSub(subInfo);
    setLoading(false);
  }, [uid, supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!sessionId || !uid) return;
    fetch(`/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await parseApiJson<{ active?: boolean; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Vérification échouée");
        if (data.active) {
          setFeedback({ type: "ok", text: "Plan mis à jour." });
          await loadData();
        }
      })
      .catch((e) => setFeedback({ type: "err", text: (e as Error).message }));
  }, [sessionId, uid, loadData]);

  useEffect(() => {
    if (searchParams.get("upgraded") === "1" && !sessionId) {
      setFeedback({ type: "ok", text: "Plan mis à jour." });
    }
  }, [searchParams, sessionId]);

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

  const upgradePlans = useMemo(() => getUpgradePlans(planId), [planId]);

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
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: targetPlanId, billing, upgrade: true }),
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
  const priceBilling =
    sub?.mode === "one_time"
      ? "weekly"
      : sub?.mode === "subscription" && sub.amount != null && plan.priceWeeklyEur != null
        ? Math.abs(sub.amount - monthlyPriceCents(plan.priceWeeklyEur)) <
          Math.abs(sub.amount - weeklyPriceCents(plan))
          ? "monthly"
          : "weekly"
        : parseBillingInterval(null);
  const price =
    sub?.mode === "one_time"
      ? displayPrice(getPlan("test"), "weekly")
      : displayPrice(plan, priceBilling);
  const isPeriodic = sub?.mode === "subscription";
  const canManage = !!sub?.hasCustomer;
  const isCancelling = sub?.cancelAtPeriodEnd && !sub?.cancelAt;
  const statusLabel = STATUS_LABEL[sub?.status || "active"] ?? sub?.status ?? "Actif";

  const renewalLine = (() => {
    if (loading || !sub) return null;
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
                <h2 className="fact-sheet__plan">{plan.name}</h2>
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
              {canManage ? (
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={openPortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? "Ouverture…" : "Factures & paiement"}
                </button>
              ) : (
                <p className="fact-page__muted">
                  <a href="mailto:hello@blowmyjob.fr">hello@blowmyjob.fr</a>
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {upgradePlans.length > 0 && (
        <section
          ref={upgradeRef}
          className={`fact-sheet${showUpgrade ? " fact-sheet--focus" : ""}`}
        >
          <div className="fact-sheet__section-head">
            <div>
              <h3>Changer de formule</h3>
              <p className="fact-page__muted">
                Besoin de plus de dossiers inclus ? Choisissez une formule supérieure.
              </p>
            </div>
            <div className="fact-sheet__toggle" role="group" aria-label="Facturation">
              <button
                type="button"
                className={billing === "weekly" ? "is-active" : ""}
                onClick={() => setBilling("weekly")}
              >
                Semaine
              </button>
              <button
                type="button"
                className={billing === "monthly" ? "is-active" : ""}
                onClick={() => setBilling("monthly")}
              >
                Mois −{MONTHLY_DISCOUNT_PERCENT}%
              </button>
            </div>
          </div>

          <ul className="fact-plans">
            {upgradePlans.map((p) => {
              const pPrice = displayPrice(p, billing);
              const busy = checkoutPlanId !== null;
              const isLoading = checkoutPlanId === p.id;
              const isSuggested = p.id === suggestedPlanId;

              return (
                <li key={p.id} className={`fact-plans__row${isSuggested ? " is-suggested" : ""}`}>
                  <div className="fact-plans__info">
                    <strong>{p.name}</strong>
                    <span className="fact-page__muted">
                      {applicationsQuotaLabel(p)}
                    </span>
                  </div>
                  <div className="fact-plans__side">
                    <div className="fact-plans__price-wrap">
                      <span className="fact-plans__price">
                        {pPrice.amount} €<small>{pPrice.suffix}</small>
                      </span>
                      {pPrice.billingSavings && (
                        <span className="fact-plans__billing-note">{pPrice.billingSavings}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      disabled={busy || loading}
                      onClick={() => startUpgrade(p.id)}
                    >
                      {isLoading ? "…" : "Choisir"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section
        ref={creditsRef}
        className={`fact-sheet${showCredits ? " fact-sheet--focus" : ""}`}
      >
        <div className="fact-sheet__section-head">
          <div>
            <h3>Ajouter des dossiers</h3>
            <p className="fact-page__muted">
              Pour débloquer quelques dossiers sans changer de formule.
            </p>
            {quotaUsage && quotaUsage.bonusCredits > 0 && (
              <p className="fact-page__muted fact-page__bonus">
                {quotaUsage.bonusCredits} bonus restant
                {quotaUsage.bonusCredits > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>

        <div className="fact-packs">
          {CREDIT_PACKS_LIST.map((pack) => {
            const busy = checkoutPackId !== null;
            const isLoading = checkoutPackId === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                className={`fact-packs__item${pack.featured ? " is-featured" : ""}`}
                disabled={busy || loading}
                onClick={() => buyCredits(pack.id)}
              >
                <span className="fact-packs__count">{pack.credits}</span>
                <span className="fact-packs__label">dossiers</span>
                <span className="fact-packs__hint">{pack.hint}</span>
                <span className="fact-packs__price">{formatPriceEur(pack.priceEur)} €</span>
                {isLoading && <span className="fact-packs__loading">…</span>}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
