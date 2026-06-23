"use client";

import Link from "next/link";
import Header from "@/components/Header";
import AffiliateTopBanner from "@/components/AffiliateTopBanner";
import ReferralSimulator from "@/components/ReferralSimulator";
import { useAuth } from "@/lib/useAuth";

export default function AmbassadeurPage() {
  const { uid } = useAuth();
  const affiliateCtaHref = uid
    ? "/dashboard/parrainage"
    : "/signup-affiliate?next=%2Fdashboard%2Fparrainage";

  return (
    <main className="affiliate-page">
      <AffiliateTopBanner ctaHref={affiliateCtaHref} />
      <div className="affiliate-shell">
        <Header />

        <section className="affiliate-hero">
          <span className="affiliate-eyebrow">Programme ambassadeur</span>
          <h1>Gagnez 35% sur chaque paiement de vos filleuls</h1>
          <p>
            Commission récurrente tant qu&apos;ils restent abonnés. Votre audience obtient −15%
            sur les formules avec votre code.
          </p>
          <div className="affiliate-actions">
            <Link href={affiliateCtaHref} className="btn btn--accent">
              Créer mon code
            </Link>
            <a href="#simulateur" className="btn btn--outline">
              Simuler mes gains
            </a>
          </div>
        </section>

        <section className="affiliate-steps">
          <article>
            <strong>1</strong>
            <h2>Définissez votre code</h2>
            <p>Choisissez un code simple depuis votre onglet Parrainage.</p>
          </article>
          <article>
            <strong>2</strong>
            <h2>Partagez le lien</h2>
            <p>Le code est appliqué au checkout et donne -15% au client.</p>
          </article>
          <article>
            <strong>3</strong>
            <h2>Suivez vos gains</h2>
            <p>Chaque renouvellement d&apos;abonnement vous rapporte 35% dans votre dashboard.</p>
          </article>
        </section>

        <section className="affiliate-calculator" id="simulateur">
          <div className="affiliate-calculator__intro">
            <span className="affiliate-eyebrow">Simulateur</span>
            <h2>Combien pouvez-vous gagner ?</h2>
            <p>
              Filleuls actifs × abonnement payé × 35%. Tant qu&apos;ils restent
              abonnés, vous touchez la commission chaque mois.
            </p>
          </div>
          <ReferralSimulator defaultReferrals={25} maxReferrals={150} />
        </section>

        <section className="affiliate-details">
          <h2>Ce qui est inclus</h2>
          <div>
            <p><strong>Commission :</strong> 35% de l&apos;abonnement, à chaque paiement, tant que le filleul reste client.</p>
            <p><strong>Réduction filleul :</strong> −15% avec votre code ambassadeur.</p>
            <p><strong>Tracking :</strong> code, filleuls, CA apporté et gains visibles dans le dashboard.</p>
            <p><strong>Payouts :</strong> prévus ensuite.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

