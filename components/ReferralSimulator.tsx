"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { PLANS, planMonthlyPriceEur } from "@/lib/plans";

type Props = {
  discountPercent?: number;
  commissionRate?: number;
  maxReferrals?: number;
  defaultReferrals?: number;
  /** Version compacte (page publique) */
  compact?: boolean;
  /** Bandeau discret pour le dashboard */
  variant?: "default" | "dashboard";
};

const fmt = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);

export default function ReferralSimulator({
  discountPercent = 15,
  commissionRate = 0.35,
  maxReferrals = 150,
  defaultReferrals = 25,
  compact = false,
  variant = "default",
}: Props) {
  const isDashboard = variant === "dashboard";
  const [referrals, setReferrals] = useState(defaultReferrals);

  const monthlyPrice = useMemo(
    () => planMonthlyPriceEur(PLANS.chill) ?? 0,
    []
  );

  const paidAfterDiscount = monthlyPrice * (1 - discountPercent / 100);
  const perClient = paidAfterDiscount * commissionRate;
  const monthlyIncome = perClient * referrals;
  const yearlyIncome = monthlyIncome * 12;

  return (
    <div
      className={`ref-sim${compact ? " ref-sim--compact" : ""}${isDashboard ? " ref-sim--dashboard" : ""}`}
      style={{ "--ref-sim-pct": `${((referrals - 1) / (maxReferrals - 1)) * 100}%` } as CSSProperties}
    >
      {isDashboard && (
        <p className="ref-sim__dashboard-note">
          Estimation si vos filleuls restent abonnés — 35% à chaque paiement.
        </p>
      )}

      <div className="ref-sim__controls">
        <div className="ref-sim__field">
          <div className="ref-sim__field-head">
            <span className="ref-sim__label">Filleuls abonnés</span>
            <output className="ref-sim__badge" aria-live="polite">{referrals}</output>
          </div>
          <input
            type="range"
            className="ref-sim__range"
            min={1}
            max={maxReferrals}
            value={referrals}
            onChange={(e) => setReferrals(Number(e.target.value))}
            aria-label="Nombre de filleuls abonnés"
          />
        </div>

        <div className="ref-sim__field">
          <span className="ref-sim__label">Formule moyenne</span>
          <div className="ref-sim__toggle" role="group" aria-label="Formule moyenne">
            <button type="button" className="is-active">
              Essentiel
            </button>
          </div>
          {!isDashboard && (
            <span className="ref-sim__hint">Facturation mensuelle · −{discountPercent}% avec votre code</span>
          )}
        </div>
      </div>

      <div className="ref-sim__result">
        {!isDashboard && <span className="ref-sim__result-kicker">Vos gains estimés</span>}
        <div className="ref-sim__result-main">
          <strong>{fmt(monthlyIncome)}</strong>
          <span>/ mois</span>
        </div>
        {!isDashboard && (
          <>
            <p className="ref-sim__result-sub">
              Soit <strong>{fmt(yearlyIncome)}</strong> par an si vos {referrals} filleuls restent abonnés.
            </p>
            <div className="ref-sim__breakdown">
              <div>
                <span>Prix payé par le filleul / mois</span>
                <strong>{fmt(paidAfterDiscount)}</strong>
              </div>
              <div>
                <span>Votre commission ({Math.round(commissionRate * 100)}%)</span>
                <strong>{fmt(perClient)}</strong>
              </div>
              <div>
                <span>× {referrals} filleuls abonnés</span>
                <strong>{fmt(monthlyIncome)}</strong>
              </div>
            </div>
          </>
        )}
        {isDashboard && (
          <p className="ref-sim__result-sub ref-sim__result-sub--dash">
            {fmt(perClient)} / filleul · {fmt(yearlyIncome)} / an
          </p>
        )}
      </div>
    </div>
  );
}
