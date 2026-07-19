import { FREE_DISCOVERY_OFFER } from "@/lib/plans";

/** Carte Découverte affichée comme formule déjà active (essai gratuit). */
export default function CurrentDiscoveryPlanCard() {
  return (
    <article className="pricing-card pricing-card--current fact-upgrade__card" aria-current="true">
      <p className="pricing-card__tagline">{FREE_DISCOVERY_OFFER.tagline}</p>
      <div className="pricing-card__name-row">
        <h3 className="pricing-card__title">{FREE_DISCOVERY_OFFER.name}</h3>
        <span className="pricing-card__label pricing-card__label--current">Actuel</span>
      </div>

      <div className="pricing-card__price">
        <strong>{FREE_DISCOVERY_OFFER.priceLabel}</strong>
        <span>{FREE_DISCOVERY_OFFER.priceSuffix}</span>
      </div>

      <div className="pricing-card__savings-slot" />

      <p className="pricing-card__desc">{FREE_DISCOVERY_OFFER.description}</p>

      <div className="pricing-card__cta-wrap">
        <span className="btn btn--outline pricing-card__cta pricing-card__cta--current">
          Déjà choisi
        </span>
      </div>

      <ul className="pricing-card__features">
        {FREE_DISCOVERY_OFFER.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </article>
  );
}
