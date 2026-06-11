import Link from "next/link";
import BrandName from "./BrandName";

export default function LegalPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="legal-page">
      <div className="bg-decor" aria-hidden="true" />
      <header className="legal-page__head">
        <Link href="/" className="legal-page__brand">
          <img src="/logo.png" alt="" width={32} height={32} />
          <BrandName />
        </Link>
      </header>
      <main className="legal-page__main">
        <h1>{title}</h1>
        <div className="legal-page__body">{children}</div>
        <p className="legal-page__back">
          <Link href="/">Retour à l&apos;accueil</Link>
        </p>
      </main>
    </div>
  );
}
