"use client";

const STEPS = [
  {
    emoji: "🪄",
    title: "Chromium s'ouvre tout seul",
    text: "Pas besoin de l'installer : JEAN PAUL le télécharge automatiquement la première fois (~1 min).",
    visual: (
      <div className="tuto__browser">
        <div className="tuto__browser-bar">
          <span /><span /><span />
        </div>
        <div className="tuto__browser-body">
          <div className="tuto__spark">✨</div>
          <div className="tuto__browser-line tuto__browser-line--wide" />
          <div className="tuto__browser-line" />
        </div>
      </div>
    ),
  },
  {
    emoji: "🔑",
    title: "Connectez-vous à LinkedIn (1ʳᵉ fois)",
    text: "La fenêtre s'ouvre sur LinkedIn : connectez-vous une seule fois, la session est mémorisée pour les prochaines fois.",
    visual: (
      <div className="tuto__browser">
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
    emoji: "✅",
    title: "Vérifiez et cliquez Submit",
    text: "Un onglet par offre, formulaire déjà rempli avec votre CV et votre lettre. Vous relisez, vous cliquez Submit. C'est tout.",
    visual: (
      <div className="tuto__browser">
        <div className="tuto__browser-bar">
          <span /><span /><span />
          <em>3 onglets prêts</em>
        </div>
        <div className="tuto__browser-body">
          <div className="tuto__field tuto__field--filled">Grégoire Linée ✓</div>
          <div className="tuto__field tuto__field--filled">CV_adapté.pdf ✓</div>
          <div className="tuto__btn-fake tuto__btn-fake--go">Submit</div>
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
      <div className="tuto" onClick={(e) => e.stopPropagation()}>
        <button className="tuto__close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
        <h2 className="tuto__title">Postuler en automatique, comment ça marche ?</h2>
        <div className="tuto__steps">
          {STEPS.map((s, i) => (
            <div className="tuto__step" key={i}>
              {s.visual}
              <div className="tuto__step-head">
                <span className="tuto__step-num">{i + 1}</span>
                <span className="tuto__step-emoji">{s.emoji}</span>
                <h3>{s.title}</h3>
              </div>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
        <div className="tuto__actions">
          <button className="btn btn--outline btn--sm" onClick={onClose}>
            Plus tard
          </button>
          <button className="btn btn--coral btn--sm" onClick={onLaunch} disabled={launching}>
            {launching ? "Lancement…" : "C'est parti 🚀"}
          </button>
        </div>
      </div>
    </div>
  );
}
