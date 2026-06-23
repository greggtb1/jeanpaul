"use client";

import { useEffect, useMemo, useState } from "react";
import ReferralSimulator from "@/components/ReferralSimulator";
import { buildReferralOnboardingUrl } from "@/lib/referral-storage";

type ReferralCode = {
  code: string;
  discount_percent: number;
  commission_rate: number;
  is_active: boolean;
};

type Conversion = {
  id: string;
  referred_email: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  amount_paid_cents: number;
  commission_cents: number;
  status: string;
  paid_at: string;
};

type ReferralPayload = {
  code: ReferralCode | null;
  stats: {
    referred_count: number;
    sales_count: number;
    revenue_cents: number;
    earned_cents: number;
  };
  conversions: Conversion[];
  defaults: {
    discount_percent: number;
    commission_rate: number;
  };
};

const fmtMoney = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso)
  );

const planLabel: Record<string, string> = {
  test: "Découverte",
  chill: "Essentiel",
  tryhard: "Intensif",
};

export default function ParrainagePage() {
  const [data, setData] = useState<ReferralPayload | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/referrals");
    const payload = (await res.json()) as ReferralPayload & { error?: string };
    if (!res.ok) {
      setFeedback(payload.error || "Impossible de charger le parrainage.");
      setLoading(false);
      return;
    }
    setData(payload);
    setCodeInput(payload.code?.code ?? "");
    setEditing(!payload.code?.code);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const shareOnboardingUrl = useMemo(() => {
    if (!data?.code?.code) return "";
    return buildReferralOnboardingUrl(data.code.code);
  }, [data?.code?.code]);

  async function copyLink() {
    if (!shareOnboardingUrl) return;
    await navigator.clipboard.writeText(shareOnboardingUrl);
    setFeedback("Lien copié.");
  }

  async function copyCode() {
    if (!data?.code?.code) return;
    await navigator.clipboard.writeText(data.code.code);
    setFeedback("Code copié.");
  }

  async function saveCode() {
    setSaving(true);
    setFeedback("");
    const res = await fetch("/api/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codeInput }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setFeedback(payload.error || "Code impossible à enregistrer.");
      setSaving(false);
      return;
    }
    setFeedback("Code enregistré.");
    setEditing(false);
    await load();
    setSaving(false);
  }

  const hasCode = !!data?.code?.code;

  return (
    <main className="db__main referral-dash">
      <header className="referral-page-head">
        <h1>Parrainage</h1>
        <p>Vous touchez 35% à chaque paiement. Vos filleuls ont −15% avec votre code.</p>
      </header>

      <section className="referral-panel">
        <h2>À partager</h2>

        {hasCode && !editing ? (
          <>
            <div className="referral-share-box">
              <span className="referral-share-box__code">{data!.code!.code}</span>
              <div className="referral-share-box__actions">
                <button type="button" className="btn btn--accent btn--sm" onClick={copyLink}>
                  Copier le lien
                </button>
                <button type="button" className="btn btn--outline btn--sm" onClick={copyCode}>
                  Copier le code
                </button>
              </div>
            </div>
            <button
              type="button"
              className="referral-text-btn"
              onClick={() => {
                setEditing(true);
                setFeedback("");
              }}
            >
              Modifier le code
            </button>
          </>
        ) : (
          <div className="referral-code-form">
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="VOTRECODE"
              maxLength={24}
              aria-label="Code ambassadeur"
            />
            <button
              type="button"
              className="btn btn--accent btn--sm"
              onClick={saveCode}
              disabled={saving || codeInput.length < 3}
            >
              {saving ? "…" : hasCode ? "Enregistrer" : "Créer mon code"}
            </button>
            {hasCode && (
              <button
                type="button"
                className="referral-text-btn"
                onClick={() => {
                  setEditing(false);
                  setCodeInput(data?.code?.code ?? "");
                  setFeedback("");
                }}
              >
                Annuler
              </button>
            )}
          </div>
        )}

        {feedback && <p className="referral-feedback">{feedback}</p>}
      </section>

      <section className="referral-stats referral-stats--simple">
        <article>
          <span>Parrainés</span>
          <strong>{data?.stats.referred_count ?? 0}</strong>
        </article>
        <article>
          <span>Gains</span>
          <strong>{fmtMoney(data?.stats.earned_cents ?? 0)}</strong>
        </article>
      </section>

      <section className="referral-panel">
        <h2>Historique</h2>
        {loading ? (
          <p className="referral-empty">Chargement…</p>
        ) : !data?.conversions.length ? (
          <p className="referral-empty">Aucun paiement pour le moment.</p>
        ) : (
          <div className="referral-table">
            {data.conversions.map((row) => (
              <div key={row.id} className="referral-row">
                <span>{row.referred_email || "Client"}</span>
                <span>{planLabel[row.plan_id || ""] || row.plan_id || "—"}</span>
                <strong>{fmtMoney(row.commission_cents)}</strong>
                <small>{fmtDate(row.paid_at)}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="referral-sim-details">
        <summary>Estimer vos gains</summary>
        <ReferralSimulator
          variant="dashboard"
          defaultReferrals={10}
          maxReferrals={100}
          discountPercent={data?.defaults.discount_percent ?? 15}
          commissionRate={data?.defaults.commission_rate ?? 0.35}
        />
      </details>
    </main>
  );
}
