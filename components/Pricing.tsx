import Link from "next/link";
import {
  LAUNCH_PRICE_EUR,
  PLANS_LIST,
  planQuery,
  type PlanId,
} from "@/lib/plans";

export default function Pricing() {
  return (
    <section className="section section--pricing" id="tarifs">
      <div className="container">
        <div className="section__head">
          <span className="eyebrow">Tarifs</span>
          <h2 className="section__title">Un abonnement, pas une commission</h2>
          <p className="section__subtitle">
            Vous payez pour le temps gagné, pas un pourcentage sur votre salaire.
            Sans engagement, résiliable à tout moment. Choisissez l&apos;intensité
            qui correspond à votre recherche.
          </p>
        </div>

        <div className="pricing__grid">
          {PLANS_LIST.map((plan) => (
            <article
              key={plan.id}
              className={`pricing-card${plan.featured ? " pricing-card--featured" : ""}`}
            >
              {plan.featured && (
                <span className="pricing-card__badge">Le plus populaire</span>
              )}
              <span className="pricing-card__launch">Offre lancement</span>

              <div className="pricing-card__head">
                <h3>{plan.name}</h3>
                <p className="pricing-card__tagline">{plan.tagline}</p>
              </div>

              <div className="pricing-card__price">
                <span className="pricing-card__price-old">{plan.listPrice} €</span>
                <strong>{LAUNCH_PRICE_EUR}</strong>
                <span>€ / mois</span>
              </div>

              <p className="pricing-card__desc">{plan.description}</p>

              <ul className="pricing-card__features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>

              <Link
                href={`/onboarding${planQuery(plan.id as PlanId)}`}
                className={`btn pricing-card__cta${plan.featured ? " btn--coral" : " btn--outline"}`}
              >
                Démarrer à {LAUNCH_PRICE_EUR} €
              </Link>
            </article>
          ))}
        </div>

        <p className="pricing__note">
          <strong>Offre lancement :</strong> tous les plans à {LAUNCH_PRICE_EUR} €/mois
          via Stripe. Le tarif affiché barré sera appliqué plus tard selon votre plan choisi
          est enregistré dès l&apos;inscription.
        </p>
      </div>
    </section>
  );
}
