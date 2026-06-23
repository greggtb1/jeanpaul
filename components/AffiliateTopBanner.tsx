import Link from "next/link";

type Props = {
  ctaHref?: string;
  ctaLabel?: string;
};

export default function AffiliateTopBanner({
  ctaHref = "/ambassadeur",
  ctaLabel = "Commencer aujourd'hui",
}: Props) {
  return (
    <div className="affiliate-top-banner">
      <img
        src="/images/affiliate-coins.png"
        alt=""
        className="affiliate-top-banner__coins"
        width={56}
        height={56}
      />
      <span className="affiliate-top-banner__text">
        Gagnez <strong>35%</strong> de l&apos;abonnement de chaque filleul à vie
      </span>
      <Link href={ctaHref}>{ctaLabel}</Link>
    </div>
  );
}
