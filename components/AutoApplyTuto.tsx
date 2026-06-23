"use client";

import Link from "next/link";

const STEPS = [
  {
    num: 1,
    title: "Installez l'app",
    text: "Mac ou PC. Chromium se télécharge tout seul au premier lancement.",
    visual: (
      <div className="aat__visual aat__visual--app">
        <img src="/logo.png" alt="" width={40} height={40} className="aat__app-icon" />
        <strong>BLOW MY JOB Agent</strong>
        <span>Sur votre ordinateur</span>
      </div>
    ),
  },
  {
    num: 2,
    title: "Connectez-vous à LinkedIn",
    text: "Une seule fois. La session est mémorisée.",
    visual: (
      <div className="aat__visual aat__visual--browser">
        <div className="aat__browser-bar">
          <span /><span /><span />
          <em>linkedin.com</em>
        </div>
        <div className="aat__browser-body">
          <div className="aat__field">votre@email.com</div>
          <div className="aat__field">••••••••</div>
          <button className="aat__btn-fake">Se connecter</button>
        </div>
      </div>
    ),
  },
  {
    num: 3,
    title: "Vérifiez et envoyez",
    text: "Formulaire déjà rempli. Vous relisez, vous cliquez Envoyer.",
    visual: (
      <div className="aat__visual aat__visual--browser">
        <div className="aat__browser-bar">
          <span /><span /><span />
          <em>Formulaire prêt</em>
        </div>
        <div className="aat__browser-body">
          <div className="aat__field aat__field--ok">Votre nom ✓</div>
          <div className="aat__field aat__field--ok">CV_adapté.pdf ✓</div>
          <button className="aat__btn-fake aat__btn-fake--go">Envoyer</button>
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
        className="aat"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aat-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="tuto__close" type="button" onClick={onClose} aria-label="Fermer">×</button>

        <h2 id="aat-title" className="aat__title">Comment fonctionne Postuler ?</h2>
        <p className="aat__lead">L&apos;auto-apply tourne sur <strong>votre ordinateur</strong>.</p>

        <ol className="aat__steps">
          {STEPS.map((s) => (
            <li key={s.num} className="aat__step">
              {s.visual}
              <div className="aat__step-num">{s.num}</div>
              <strong className="aat__step-title">{s.title}</strong>
              <p className="aat__step-text">{s.text}</p>
            </li>
          ))}
        </ol>

        <div className="aat__footer">
          <Link
            href="/download"
            target="_blank"
            rel="noopener noreferrer"
            className="aat__dl-link"
            onClick={(e) => e.stopPropagation()}
          >
            Télécharger BLOW MY JOB Agent
          </Link>
          <button
            type="button"
            className="btn btn--coral aat__launch-btn"
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
