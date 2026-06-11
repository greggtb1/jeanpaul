import Link from "next/link";
import ProductMockup from "./ProductMockup";

export default function Hero() {
  return (
    <section className="hero">
      <div className="hero__left">
        <h1 className="hero__title">
          Postulez sans<br />
          l&apos;effort{" "}
          <mark className="hero__mark">répétitif.</mark>
        </h1>

        <p className="hero__subtitle">
          JEAN PAUL détecte les offres qui vous correspondent, génère un CV et une
          lettre de motivation propres à chaque offre, et postule pour vous.
        </p>

        <div className="hero__cta">
          <Link href="/onboarding" className="btn btn--outline">
            Démarrer
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>

        <div className="hero__social">
          <div className="hero__stat">
            <span className="hero__stat-prefix" aria-hidden="true" />
            <span className="hero__stat-value">+6 350</span>
            <span className="hero__stat-label">candidatures soumises sans lever le petit doigt</span>
          </div>
          <div className="hero__stat-divider" aria-hidden="true" />
          <div className="hero__stat">
            <span className="hero__stat-prefix">en moyenne</span>
            <span className="hero__stat-value">3 entretiens</span>
            <span className="hero__stat-label">débloqués en 1 semaine</span>
          </div>
          <div className="hero__stat-divider" aria-hidden="true" />
          <div className="hero__reassurance-inline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" stroke="#0040f0" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="m9 12 2 2 4-4" stroke="#0040f0" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Vous validez avant l&apos;envoi
          </div>
        </div>
      </div>

      <ProductMockup />
    </section>
  );
}
