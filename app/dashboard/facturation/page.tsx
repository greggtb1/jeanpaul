"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import {
  CREDIT_PACKS_LIST,
  MONTHLY_DISCOUNT_PERCENT,
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
  if (!iso) return "Non renseigné";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function fmtAmount(amount: number | null, currency: string | null) {
  if (amount == null) return "Non renseigné";
  const cur = (currency || "eur").toUpperCase();
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur }).format(
    amount / 100
  );
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: "Actif", cls: "fact-badge--green" },
  trialing: { label: "Essai gratuit", cls: "fact-badge--blue" },
  past_due: { label: "Paiement en retard", cls: "fact-badge--red" },
  canceled: { label: "Résilié", cls: "fact-badge--gray" },
  incomplete: { label: "Incomplet", cls: "fact-badge--gray" },
  incomplete_expired: { label: "Expiré", cls: "fact-badge--gray" },
  unpaid: { label: "Impayé", cls: "fact-badge--red" },
  paused: { label: "En pause", cls: "fact-badge--gray" },
  none: { label: "Accès activé", cls: "fact-badge--green" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: "fact-badge--gray" };
  return <span className={`fact-badge ${s.cls}`}>{s.label}</span>;
}

export default function FacturationPage() {
  const searchParams = useSearchParams();
  const { uid, loading: authLoading } = useAuth();
  const supabase = createClient();
  const upgradeRef = useRef<HTMLElement>(null);
  const creditsRef = useRef<HTMLElement>(null);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ offers: 0, ready: 0, searches: 0 });
  const [planId, setPlanId] = useState(parsePlanId(null));
  const [quotaUsage, setQuotaUsage] = useState<ReturnType<typeof getQuotaUsage> | null>(null);
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [checkoutPlanId, setCheckoutPlanId] = useState<PlanId | null>(null);
  const [checkoutPackId, setCheckoutPackId] = useState<CreditPackId | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const showUpgrade = searchParams.get("upgrade") === "1";
  const showCredits = searchParams.get("credits") === "1";
  const cancelled = searchParams.get("cancelled") === "1";
  const suggestedPlanId = parsePlanId(searchParams.get("plan"));
  const sessionId = searchParams.get("session_id");
  const creditsSessionId = searchParams.get("credits_session");

  const [billing, setBilling] = useState<BillingInterval>(
    parseBillingInterval(searchParams.get("billing"))
  );

  const loadData = useCallback(async () => {
    if (!uid) return;
    const [profileRes, jobsRes, runsRes, subRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("plan_id, first_search_done, bonus_credits")
        .eq("id", uid)
        .maybeSingle(),
      supabase
        .from("jobs")
        .select("url,cv_url,updated_at", { count: "exact", head: false })
        .eq("user_id", uid)
        .eq("deleted", false),
      supabase
        .from("pipeline_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("status", "done"),
      fetch("/api/stripe/subscription").then((r) => r.json()),
    ]);
    setPlanId(parsePlanId(profileRes.data?.plan_id));
    const jobs = jobsRes.data || [];
    const plan = getPlan(profileRes.data?.plan_id);
    setQuotaUsage(
      getQuotaUsage(plan, {
        generatedCount: countGeneratedJobs(jobs),
        weeklyGeneratedCount: countWeeklyGeneratedJobs(jobs),
        firstSearchDone: !!profileRes.data?.first_search_done,
        bonusCredits: profileRes.data?.bonus_credits ?? 0,
      })
    );
    setStats({
      offers: jobs.length,
      ready: jobs.filter((j) => j.cv_url).length,
      searches: runsRes.count ?? 0,
    });
    setSub(subRes as SubscriptionInfo);
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
          setSuccessMsg("Paiement confirmé — votre plan a été mis à jour.");
          await loadData();
        }
      })
      .catch((e) => setCheckoutError((e as Error).message));
  }, [sessionId, uid, loadData]);

  useEffect(() => {
    if (searchParams.get("upgraded") === "1" && !sessionId) {
      setSuccessMsg("Votre plan a été mis à jour. Vous pouvez relancer des scans.");
    }
  }, [searchParams, sessionId]);

  useEffect(() => {
    if (!creditsSessionId || !uid) return;
    fetch(`/api/stripe/credits/verify?session_id=${encodeURIComponent(creditsSessionId)}`)
      .then(async (res) => {
        const data = await parseApiJson<{
          paid?: boolean;
          credits?: number;
          balance?: number;
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(data.error || "Vérification échouée");
        if (data.paid) {
          setSuccessMsg(
            `Paiement confirmé — ${data.credits} candidatures ajoutées à votre compte.`
          );
          await loadData();
        }
      })
      .catch((e) => setCheckoutError((e as Error).message));
  }, [creditsSessionId, uid, loadData]);

  useEffect(() => {
    if (loading) return;
    const target = showCredits ? creditsRef.current : showUpgrade ? upgradeRef.current : null;
    if (!target) return;
    const t = setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(t);
  }, [showUpgrade, showCredits, loading]);

  const upgradePlans = useMemo(() => getUpgradePlans(planId), [planId]);

  async function openPortal() {
    setPortalError("");
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      window.location.href = data.url;
    } catch (e) {
      setPortalError(e instanceof Error ? e.message : "Erreur");
      setPortalLoading(false);
    }
  }

  async function startUpgrade(targetPlanId: PlanId) {
    setCheckoutPlanId(targetPlanId);
    setCheckoutError("");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: targetPlanId,
          billing,
          upgrade: true,
        }),
      });
      const data = await parseApiJson<{
        url?: string;
        error?: string;
        upgraded?: boolean;
      }>(res);
      if (!res.ok) throw new Error(data.error || "Impossible de lancer le paiement");
      if (data.url) {
        if (data.upgraded) {
          setSuccessMsg("Votre plan a été mis à jour. Vous pouvez relancer des scans.");
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
      setCheckoutError((e as Error).message);
      setCheckoutPlanId(null);
    }
  }

  async function buyCredits(packId: CreditPackId) {
    setCheckoutPackId(packId);
    setCheckoutError("");
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
      setCheckoutError((e as Error).message);
      setCheckoutPackId(null);
    }
  }

  const plan = getPlan(planId);
  const priceBilling =
    sub?.mode === "subscription" && sub.amount != null && plan.priceWeeklyEur != null
      ? Math.abs(sub.amount - monthlyPriceCents(plan.priceWeeklyEur)) <
        Math.abs(sub.amount - weeklyPriceCents(plan))
        ? "monthly"
        : "weekly"
      : parseBillingInterval(null);
  const price = displayPrice(plan, priceBilling);
  const isPeriodic = sub?.mode === "subscription";
  const canManage = !!sub?.hasCustomer;
  const isCancelling = sub?.cancelAtPeriodEnd && !sub?.cancelAt;
  const isCancelled = sub?.status === "canceled" || !!sub?.cancelAt;

  return (
    <main className="db__main db__main--narrow">
      <div className="db-page-head">
        <h1>Facturation</h1>
        <p>Votre abonnement et votre utilisation.</p>
      </div>

      {successMsg && (
        <div className="fact-success" role="status">
          {successMsg}{" "}
          <a href="/dashboard" className="fact-success__link">
            Retour au tableau de bord
          </a>
        </div>
      )}

      <section className="db-panel fact-plan">
        <div className="fact-plan__top">
          <div>
            <div className="fact-plan__eyebrow">Plan actuel</div>
            <h2 className="fact-plan__name">{plan.name}</h2>
            <p className="db-muted">{plan.tagline}</p>
          </div>
          <div className="fact-plan__right">
            {loading ? null : <StatusBadge status={sub?.status || "active"} />}
            <div className="fact-plan__price">
              {price.amount} €<span>{price.suffix ? ` ${price.suffix}` : ""}</span>
            </div>
          </div>
        </div>

        {!loading && sub && (
          <div className="fact-plan__meta">
            {isPeriodic && sub.currentPeriodEnd && !isCancelled && (
              <span className="fact-meta-item">
                {isCancelling ? "⚠ Accès jusqu'au" : "Renouvellement le"}{" "}
                <strong>{fmtDate(sub.currentPeriodEnd)}</strong>
              </span>
            )}
            {isCancelled && sub.cancelAt && (
              <span className="fact-meta-item fact-meta-item--warn">
                Résiliation effective le <strong>{fmtDate(sub.cancelAt)}</strong>
              </span>
            )}
            {!isPeriodic && (
              <span className="fact-meta-item">Accès permanent · paiement unique</span>
            )}
          </div>
        )}

        {portalError && <p className="fact-error">{portalError}</p>}

        <div className="fact-plan__actions">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={openPortal}
            disabled={!canManage || portalLoading || loading}
          >
            {portalLoading ? "Ouverture…" : "Gérer l'abonnement"}
          </button>
          {!canManage && !loading && (
            <p className="fact-hint">
              Contactez <a href="mailto:hello@jeanpaul.app">hello@jeanpaul.app</a> pour toute
              question de facturation.
            </p>
          )}
        </div>

        <p className="fact-portal-note">
          Le portail Stripe vous permet de mettre à jour votre moyen de paiement, télécharger vos
          factures ou résilier.
        </p>
      </section>

      {upgradePlans.length > 0 && (
        <section
          ref={upgradeRef}
          className={`db-panel fact-upgrade${showUpgrade ? " fact-upgrade--highlight" : ""}`}
          aria-labelledby="fact-upgrade-title"
        >
          <div className="fact-upgrade__head">
            <div>
              <p className="fact-upgrade__eyebrow">Changer de formule</p>
              <h2 id="fact-upgrade-title" className="db-panel__title">
                Plus de candidatures, chaque semaine
              </h2>
              <p className="fact-upgrade__lead">
                Passez à une formule supérieure pour relancer des scans et obtenir plus de
                candidatures prêtes à envoyer chaque semaine.
              </p>
            </div>
          </div>

          <div className="fact-upgrade__billing" role="group" aria-label="Facturation">
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

          <div className="fact-upgrade__grid">
            {upgradePlans.map((p) => {
              const pPrice = displayPrice(p, billing);
              const busy = checkoutPlanId !== null;
              const isLoading = checkoutPlanId === p.id;
              const isSuggested = p.id === suggestedPlanId;

              return (
                <article
                  key={p.id}
                  className={`pricing-card fact-upgrade__card${
                    p.featured ? " pricing-card--featured" : ""
                  }${isSuggested ? " fact-upgrade__card--suggested" : ""}`}
                >
                  {p.featured && (
                    <span className="pricing-card__badge">Le plus populaire</span>
                  )}
                  {isSuggested && (
                    <span className="fact-upgrade__suggested">Recommandé</span>
                  )}

                  <div className="pricing-card__head">
                    <h3>{p.name}</h3>
                    <p className="pricing-card__tagline">{p.tagline}</p>
                  </div>

                  <div className="pricing-card__price">
                    <strong>{pPrice.amount} €</strong>
                    <span>{pPrice.suffix}</span>
                  </div>
                  {pPrice.billingSavings && (
                    <p className="pricing-card__savings">{pPrice.billingSavings}</p>
                  )}

                  <ul className="pricing-card__features">
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    className="btn btn--outline pricing-card__cta"
                    disabled={busy || loading}
                    onClick={() => startUpgrade(p.id)}
                  >
                    {isLoading ? "Redirection…" : `Choisir ${p.name}`}
                  </button>
                </article>
              );
            })}
          </div>

          {cancelled && !showCredits && (
            <p className="fact-error fact-upgrade__cancelled">
              Paiement annulé. Vous pouvez réessayer quand vous voulez.
            </p>
          )}
          {checkoutError && <p className="fact-error">{checkoutError}</p>}
          <p className="fact-hint fact-upgrade__foot">
            Paiement sécurisé par Stripe · changement effectif immédiatement après validation
          </p>
        </section>
      )}

      <section
        ref={creditsRef}
        className={`db-panel db-panel--flat fact-credits${showCredits ? " fact-upgrade--highlight" : ""}`}
        aria-labelledby="fact-credits-title"
      >
        <div className="fact-credits__head">
          <div>
            <p className="fact-credits__eyebrow">Sans changer de formule</p>
            <h2 id="fact-credits-title" className="fact-credits__title">
              Acheter des candidatures
            </h2>
            <p className="fact-credits__lead">
              Candidatures supplémentaires, utilisables tout de suite, sans engagement.
            </p>
          </div>
          {!loading && quotaUsage && quotaUsage.bonusCredits > 0 && (
            <div className="fact-credits__balance">
              <strong>{quotaUsage.bonusCredits}</strong> candidature
              {quotaUsage.bonusCredits > 1 ? "s" : ""} bonus restante
              {quotaUsage.bonusCredits > 1 ? "s" : ""}
            </div>
          )}
        </div>

        <div className="fact-credits__grid">
          {CREDIT_PACKS_LIST.map((pack) => {
            const busy = checkoutPackId !== null;
            const isLoading = checkoutPackId === pack.id;
            return (
              <article
                key={pack.id}
                className={`fact-credits__card${pack.featured ? " fact-credits__card--featured" : ""}`}
              >
                {pack.featured && (
                  <span className="fact-credits__badge">Le plus choisi</span>
                )}
                <div className="fact-credits__count">{pack.credits}</div>
                <div className="fact-credits__label">candidatures</div>
                <div className="fact-credits__hint">{pack.hint}</div>
                <div className="fact-credits__price">{formatPriceEur(pack.priceEur)} €</div>
                <button
                  type="button"
                  className="btn btn--outline btn--sm fact-credits__cta"
                  disabled={busy || loading}
                  onClick={() => buyCredits(pack.id)}
                >
                  {isLoading ? "Redirection…" : "Acheter"}
                </button>
              </article>
            );
          })}
        </div>

        {cancelled && showCredits && (
          <p className="fact-error fact-upgrade__cancelled">
            Paiement annulé. Vous pouvez réessayer quand vous voulez.
          </p>
        )}
        <p className="fact-hint fact-upgrade__foot">
          Paiement unique sécurisé par Stripe · crédits ajoutés immédiatement, sans expiration
        </p>
      </section>

      <section className="db-panel db-panel--flat">
        <h2 className="db-panel__title">Utilisation</h2>
        {authLoading || loading ? (
          <p className="db-muted">Chargement…</p>
        ) : (
          <>
            {quotaUsage && (
              <dl className="db-usage db-usage--quota">
                <div>
                  <dt>{quotaUsage.label}</dt>
                  <dd>
                    {quotaUsage.used}/{quotaUsage.limit}
                    {quotaUsage.bonusCredits > 0 && (
                      <span className="fact-quota-bonus">
                        {" "}
                        +{quotaUsage.bonusCredits} bonus
                      </span>
                    )}
                    {quotaUsage.exhausted && (
                      <span className="fact-quota-full"> · quota atteint</span>
                    )}
                  </dd>
                </div>
                {quotaUsage.searchesLimit != null && (
                  <div>
                    <dt>Recherches LinkedIn</dt>
                    <dd>
                      {quotaUsage.searchesUsed}/{quotaUsage.searchesLimit}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            <dl className="db-usage">
            <div>
              <dt>Offres trouvées</dt>
              <dd>{stats.offers}</dd>
            </div>
            <div>
              <dt>Candidatures générées</dt>
              <dd>{stats.ready}</dd>
            </div>
            <div>
              <dt>Recherches lancées</dt>
              <dd>{stats.searches}</dd>
            </div>
            </dl>
          </>
        )}
      </section>

      <section className="db-panel db-panel--flat">
        <h2 className="db-panel__title">Dernier paiement</h2>
        {loading ? (
          <p className="db-muted">Chargement…</p>
        ) : sub?.lastInvoiceDate ? (
          <div className="fact-invoice">
            <div className="fact-invoice__row">
              <span className="fact-invoice__label">Date</span>
              <span>{fmtDate(sub.lastInvoiceDate)}</span>
            </div>
            <div className="fact-invoice__row">
              <span className="fact-invoice__label">Montant</span>
              <span>{fmtAmount(sub.lastInvoiceAmount, sub.currency)}</span>
            </div>
            {sub.lastInvoicePdfUrl && (
              <div className="fact-invoice__row">
                <span className="fact-invoice__label">Reçu</span>
                <a
                  href={sub.lastInvoicePdfUrl}
                  target="_blank"
                  rel="noopener"
                  className="fact-invoice__link"
                >
                  Télécharger
                </a>
              </div>
            )}
          </div>
        ) : (
          <p className="db-muted">Aucun paiement trouvé.</p>
        )}
        {canManage && (
          <p className="fact-hint" style={{ marginTop: 10 }}>
            Toutes vos factures sont accessibles via{" "}
            <button
              type="button"
              className="fact-link-btn"
              onClick={openPortal}
              disabled={portalLoading}
            >
              le portail Stripe
            </button>
            .
          </p>
        )}
      </section>
    </main>
  );
}
