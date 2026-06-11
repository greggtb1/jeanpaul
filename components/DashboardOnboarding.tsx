"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "jp_dashboard_onboarding_v1";

const STEPS = [
  {
    icon: "🔍",
    title: "Scanner",
    body: "JEAN PAUL parcourt LinkedIn selon vos critères et récupère les offres qui correspondent. Vous n'avez rien à faire.",
    detail: "Un scan prend environ 5 minutes. Vous pouvez même fermer la fenêtre si vous voulez.",
  },
  {
    icon: "🧠",
    title: "Score sur 10",
    body: "Chaque offre est notée par JEAN PAUL selon votre profil. Bleu pâle, peu pertinent. Bleu foncé, très bon match.",
    detail: "Seules les offres à 6 et plus ont un CV et une lettre générés.",
  },
  {
    icon: "📄",
    title: "CV et lettre",
    body: "Pour chaque bonne offre, JEAN PAUL adapte votre CV et écrit une lettre ciblée. Les documents apparaissent directement dans la fiche.",
    detail: "Cliquez sur CV ou Lettre pour les voir ou les télécharger.",
  },
  {
    icon: "✅",
    title: "Postuler",
    body: "Sélectionnez les offres qui vous intéressent et lancez la postulation. Chromium pré-remplit les formulaires à votre place.",
    detail: "JEAN PAUL fait le sale boulot. Vous n'avez plus qu'à cliquer Submit.",
  },
];

export default function DashboardOnboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem(STORAGE_KEY)) {
      setOpen(true);
    }
  }, []);

  function close() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="dob__overlay" role="dialog" aria-modal="true" aria-label="Comment fonctionne JEAN PAUL">
      <div className="dob__panel">
        <button className="dob__close" onClick={close} aria-label="Fermer">✕</button>

        <div className="dob__progress">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={`dob__dot${i === step ? " dob__dot--active" : i < step ? " dob__dot--done" : ""}`}
              onClick={() => setStep(i)}
              aria-label={`Étape ${i + 1}`}
            />
          ))}
        </div>

        <div className="dob__step" key={step}>
          <div className="dob__icon" aria-hidden="true">{s.icon}</div>
          <h2 className="dob__title">{s.title}</h2>
          <p className="dob__body">{s.body}</p>
          <p className="dob__detail">{s.detail}</p>
        </div>

        <div className="dob__nav">
          {step > 0 && (
            <button className="dob__btn-back" onClick={() => setStep(step - 1)}>Retour</button>
          )}
          <button
            className={`dob__btn-next${isLast ? " dob__btn-next--done" : ""}`}
            onClick={isLast ? close : () => setStep(step + 1)}
          >
            {isLast ? "C'est parti" : "Suivant"}
          </button>
        </div>
      </div>
    </div>
  );
}
