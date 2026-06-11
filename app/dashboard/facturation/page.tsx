"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { getPlan, LAUNCH_PRICE_EUR, parsePlanId } from "@/lib/plans";
import type { SubscriptionInfo } from "@/app/api/stripe/subscription/route";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

function fmtAmount(amount: number | null, currency: string | null) {
  if (amount == null) return "—";
  const cur = (currency || "eur").toUpperCase();
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur }).format(amount / 100);
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active:            { label: "Actif",             cls: "fact-badge--green" },
  trialing:          { label: "Essai gratuit",      cls: "fact-badge--blue" },
  past_due:          { label: "Paiement en retard", cls: "fact-badge--red" },
  canceled:          { label: "Résilié",            cls: "fact-badge--gray" },
  incomplete:        { label: "Incomplet",          cls: "fact-badge--gray" },
  incomplete_expired:{ label: "Expiré",             cls: "fact-badge--gray" },
  unpaid:            { label: "Impayé",             cls: "fact-badge--red" },
  paused:            { label: "En pause",           cls: "fact-badge--gray" },
  none:              { label: "Accès activé",       cls: "fact-badge--green" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: "fact-badge--gray" };
  return <span className={`fact-badge ${s.cls}`}>{s.label}</span>;
}

export default function FacturationPage() {
  const { uid, loading: authLoading } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ offers: 0, ready: 0, searches: 0 });
  const [planId, setPlanId] = useState(parsePlanId(null));
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");

  const loadData = useCallback(async () => {
    if (!uid) return;
    const [profileRes, jobsRes, runsRes, subRes] = await Promise.all([
      supabase.from("profiles").select("plan_id").eq("id", uid).maybeSingle(),
      supabase.from("jobs").select("url,cv_url", { count: "exact", head: false })
        .eq("user_id", uid).eq("deleted", false),
      supabase.from("pipeline_runs").select("id", { count: "exact", head: true })
        .eq("user_id", uid).eq("status", "done"),
      fetch("/api/stripe/subscription").then((r) => r.json()),
    ]);
    setPlanId(parsePlanId(profileRes.data?.plan_id));
    const jobs = jobsRes.data || [];
    setStats({ offers: jobs.length, ready: jobs.filter((j) => j.cv_url).length, searches: runsRes.count ?? 0 });
    setSub(subRes as SubscriptionInfo);
    setLoading(false);
  }, [uid, supabase]);

  useEffect(() => { loadData(); }, [loadData]);

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

  const plan = getPlan(planId);
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

      {/* ── Plan & statut ── */}
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
              {LAUNCH_PRICE_EUR} €<span>/mois</span>
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
            {portalLoading ? "Ouverture…" : canManage ? "Gérer l'abonnement →" : "Gérer l'abonnement"}
          </button>
          {!canManage && !loading && (
            <p className="fact-hint">
              Contactez <a href="mailto:hello@jeanpaul.app">hello@jeanpaul.app</a> pour toute question de facturation.
            </p>
          )}
        </div>

        <p className="fact-portal-note">
          Le portail Stripe vous permet de mettre à jour votre moyen de paiement, télécharger vos factures ou résilier.
        </p>
      </section>

      {/* ── Utilisation ── */}
      <section className="db-panel db-panel--flat">
        <h2 className="db-panel__title">Utilisation</h2>
        {authLoading || loading ? (
          <p className="db-muted">Chargement…</p>
        ) : (
          <dl className="db-usage">
            <div><dt>Offres trouvées</dt><dd>{stats.offers}</dd></div>
            <div><dt>Candidatures générées</dt><dd>{stats.ready}</dd></div>
            <div><dt>Recherches lancées</dt><dd>{stats.searches}</dd></div>
          </dl>
        )}
      </section>

      {/* ── Dernière facture ── */}
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
                <a href={sub.lastInvoicePdfUrl} target="_blank" rel="noopener" className="fact-invoice__link">
                  Télécharger →
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
            <button type="button" className="fact-link-btn" onClick={openPortal} disabled={portalLoading}>
              le portail Stripe
            </button>.
          </p>
        )}
      </section>
    </main>
  );
}
