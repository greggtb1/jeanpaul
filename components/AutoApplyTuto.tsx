"use client";

import Link from "next/link";

const STEPS = [
  {
    title: "Installez l'app (1ʳᵉ fois)",
    text: "Téléchargez JEAN PAUL Agent sur votre Mac ou PC. Chromium aussi se télécharge tout seul au premier Postuler, rien à installer de votre côté.",
    visual: (
      <div className="tuto__app-card">
        <img src="/logo.png" alt="" width={44} height={44} className="tuto__app-card-icon" />
        <div>
          <strong>JEAN PAUL Agent</strong>
          <span>Sur votre ordinateur</span>
        </div>
      </div>
    ),
  },
  {
    title: "Connectez-vous à LinkedIn (1ʳᵉ fois)",
    text: "Chromium s'ouvre (téléchargé automatiquement si besoin, ~1 min). Connectez-vous une fois à LinkedIn, la session est gardée.",
    visual: (
      <div className="tuto__browser tuto__browser--soft">
        <div className="tuto__browser-bar">
          <span /><span /><span />
          <em>linkedin.com</em>
        </div>
        <div className="tuto__browser-body">
          <div className="tuto__field">votre@email.com</div>
          <div className="tuto__field">••••••••</div>
          <div className="tuto__btn-fake">Se connecter</div>
        </div>
      </div>
    ),
  },
  {
    title: "Vérifiez et envoyez",
    text: "Un onglet par offre, formulaire déjà rempli avec votre CV et votre lettre. Vous relisez, vous cliquez Envoyer.",
    visual: (
      <div className="tuto__browser tuto__browser--soft">
        <div className="tuto__browser-bar">
          <span /><span /><span />
          <em>Formulaire prêt</em>
        </div>
        <div className="tuto__browser-body">
          <div className="tuto__field tuto__field--filled">Votre nom ✓</div>
          <div className="tuto__field tuto__field--filled">CV_adapté.pdf ✓</div>
          <div className="tuto__btn-fake tuto__btn-fake--go">Envoyer</div>
        </div>
      </div>
    ),
  },
];

export default function AutoApplyTuto({
  onLaunch,
  onClose,
  launching,
}: {
  onLaunch: () => void;
  onClose: () => void;
  launching: boolean;
}) {
  return (
    <div className="tuto__overlay" onClick={onClose}>
      <div
        className="tuto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="autoapply-tuto-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="tuto__close" type="button" onClick={onClose} aria-label="Fermer">
          ×
        </button>

        <div className="tuto__intro">
          <img src="/logo.png" alt="" width={40} height={40} className="tuto__intro-icon" />
          <div>
            <h2 id="autoapply-tuto-title" className="tuto__title">
              Comment fonctionne Postuler ?
            </h2>
            <p className="tuto__lead">
              L&apos;auto-apply tourne sur <strong>votre ordinateur</strong>, pas sur le serveur.
              Voici les 3 étapes.
            </p>
          </div>
        </div>

        <ol className="tuto__steps">
          {STEPS.map((s, i) => (
            <li className="tuto__step" key={s.title}>
              {s.visual}
              <div className="tuto__step-head">
                <span className="tuto__step-num">{i + 1}</span>
                <h3>{s.title}</h3>
              </div>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>

        <p className="tuto__footnote">
          Pas encore installé ?{" "}
          <Link
            href="/download"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Télécharger JEAN PAUL Agent
          </Link>
        </p>

        <div className="tuto__actions">
          <button
            type="button"
            className="btn btn--coral"
            onClick={onLaunch}
            disabled={launching}
          >
            {launching ? "Lancement…" : "Lancer Postuler"}
          </button>
        </div>
      </div>
    </div>
  );
}
