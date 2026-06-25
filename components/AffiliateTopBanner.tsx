import Link from "next/link";

type Props = {
  ctaHref?: string;
  ctaLabel?: string;
};

function PctHighlight() {
  return (
    <span className="affiliate-top-banner__pct">
      <img
        src="/images/affiliate-coins.png"
        alt=""
        className="affiliate-top-banner__coins"
        width={56}
        height={56}
      />
      <strong>35%</strong>
    </span>
  );
}

export default function AffiliateTopBanner({
  ctaHref = "/ambassadeur",
  ctaLabel = "Commencer aujourd'hui",
}: Props) {
  return (
    <div className="affiliate-top-banner">
      <span className="affiliate-top-banner__text affiliate-top-banner__text--full">
        Touchez <PctHighlight /> de chaque paiement de vos filleuls, tant qu&apos;ils restent abonnés
      </span>
      <span className="affiliate-top-banner__text affiliate-top-banner__text--short">
        <PctHighlight /> sur chaque paiement filleul
      </span>
      <Link href={ctaHref}>{ctaLabel}</Link>
    </div>
  );
}
