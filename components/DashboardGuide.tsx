"use client";

const STEPS = [
  {
    n: "1",
    title: "Scanner",
    body: "Lancez un scan pour trouver les meilleures offres qui vous correspondent.",
  },
  {
    n: "2",
    title: "Note /10",
    body: "Score par offre. Dès 6/10 : CV + lettre générés.",
  },
  {
    n: "3",
    title: "CV et lettre",
    body: "CV optimisé ATS, lettre rédigée sur mesure.",
  },
  {
    n: "4",
    title: "Postuler",
    body: "Remplissage auto des champs LinkedIn avec vos documents.",
  },
  {
    n: "5",
    title: "Suivi",
    body: "Cochez ✓ après candidature pour ne rien oublier.",
  },
];

export default function DashboardGuide() {
  return (
    <div className="dg">
      <p className="dg__intro">Comment ça marche</p>

      <ol className="dg__steps">
        {STEPS.map((step) => (
          <li key={step.n} className="dg__step">
            <span className="dg__step-n" aria-hidden="true">
              {step.n}
            </span>
            <div className="dg__step-body">
              <strong className="dg__step-title">{step.title}</strong>
              <p className="dg__step-text">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
