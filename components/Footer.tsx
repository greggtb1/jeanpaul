import Link from "next/link";
import BrandName from "./BrandName";

const columns = [
  {
    title: "Produit",
    links: [
      { label: "Démo", href: "#" },
      { label: "Fonctionnement", href: "#fonctionnement" },
      { label: "Tarifs", href: "#tarifs" },
      { label: "Nouveautés", href: "#" },
    ],
  },
  {
    title: "Ressources",
    links: [
      { label: "Blog", href: "#" },
      { label: "Guide candidature", href: "#" },
      { label: "FAQ", href: "#faq" },
      { label: "Support", href: "#" },
    ],
  },
  {
    title: "Entreprise",
    links: [
      { label: "À propos", href: "#" },
      { label: "Confidentialité", href: "#" },
      { label: "Conditions", href: "#" },
      { label: "Contact", href: "mailto:contact@jeanpaul.app" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <div className="brand">
            <span className="brand__logo brand__logo--img">
              <img src="/logo.png" alt="JEAN PAUL" width={156} height={156} />
            </span>
            <BrandName />
          </div>
          <p className="footer__tagline">
            Vos candidatures, préparées pour vous. Vous validez, c&apos;est prêt.
          </p>
        </div>

        {columns.map((col) => (
          <div className="footer__col" key={col.title}>
            <h4>{col.title}</h4>
            {col.links.map((link) => (
              <Link href={link.href} key={link.label}>
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div className="footer__bottom">
        <span suppressHydrationWarning>© {new Date().getFullYear()} JEAN PAUL. Tous droits réservés.</span>
        <span>Fait avec soin pour les candidats pressés.</span>
      </div>
    </footer>
  );
}
