import fs from "fs";
import path from "path";
import Link from "next/link";
import { headers } from "next/headers";
import {
  AGENT_DOWNLOADS,
  agentDownloadHref,
  agentReleaseBase,
} from "@/lib/agent-downloads";

function publicAgentDir(): string {
  return path.join(process.cwd(), "public", "downloads", "agent");
}

export default async function DownloadPage() {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") || hdrs.get("host") || "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const base = agentReleaseBase(origin);
  const dir = publicAgentDir();

  const items = AGENT_DOWNLOADS.map((d) => {
    const onDisk = fs.existsSync(path.join(dir, d.file));
    return { ...d, available: onDisk, href: agentDownloadHref(base, d.file) };
  });

  const anyAvailable = items.some((i) => i.available);

  const osIcons: Record<string, string> = {
    "mac-arm": "🍎",
    "mac-intel": "🍎",
    win: "🪟",
  };

  return (
    <main className="download-page">
      <Link href="/dashboard" className="download-page__back">
        ← Dashboard
      </Link>

      <div className="download-page__hero">
        <h1>JEAN PAUL Agent</h1>
        <p>
          Chromium s&apos;ouvre sur <strong>votre</strong> écran et remplit les formulaires avec
          votre CV et vos lettres. Le scan et l&apos;analyse restent sur le site.
        </p>
      </div>

      <div className="download-page__steps">
        <div className="download-step">
          <span className="download-step__num">1</span>
          <span>Téléchargez le fichier ci-dessous (nouvel onglet)</span>
        </div>
        <div className="download-step">
          <span className="download-step__num">2</span>
          <span>Cliquez dessus pour installer l&apos;app</span>
        </div>
        <div className="download-step">
          <span className="download-step__num">3</span>
          <span>Revenez cliquer sur Postuler depuis le dashboard</span>
        </div>
      </div>

      {!anyAvailable && (
        <p className="download-page__notice">
          Installateurs en cours de déploiement. Revenez dans quelques minutes.
        </p>
      )}

      <div className="download-page__grid">
        {items.map((d) => (
          <div className={`download-card${d.available ? "" : " download-card--soon"}`} key={d.id}>
            <div className="download-card__info">
              <span className="download-card__icon">{osIcons[d.id]}</span>
              <div>
                <strong>{d.label}</strong>
                <span className="download-card__hint">{d.hint}</span>
              </div>
            </div>
            {d.available ? (
              <a
                className="download-card__btn"
                href={d.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                Télécharger
              </a>
            ) : (
              <span className="download-card__btn download-card__btn--soon">Bientôt</span>
            )}
          </div>
        ))}
      </div>

      <p className="download-page__chromium">
        <strong>Pas besoin d&apos;installer Chromium vous-même.</strong> Au premier Postuler,
        l&apos;agent le télécharge tout seul (environ 1 min, connexion internet requise). Ensuite,
        connectez-vous à LinkedIn une fois dans la fenêtre, la session est mémorisée.
      </p>
    </main>
  );
}
