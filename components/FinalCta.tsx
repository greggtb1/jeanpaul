import Link from "next/link";

export default function FinalCta() {
  return (
    <section className="section">
      <div className="container">
        <div className="finalcta">
          <h2>Moins de stress. Plus d&apos;action.</h2>
          <p>
            Laissez JEAN PAUL préparer vos candidatures. Vous validez, le reste est
            automatisé.
          </p>
          <Link href="/onboarding?plan=pro" className="btn btn--coral btn--lg">
            Démarrer à 1 €/mois
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
      </div>
    </section>
  );
}
