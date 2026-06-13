"use client";

import { useState } from "react";

const GUIDE = [
  {
    title: "Scanner",
    steps: [
      { label: "Cliquez sur Scanner", desc: "JEAN PAUL parcourt LinkedIn selon vos critères et récupère les offres qui correspondent." },
      { label: "Suivez la progression", desc: "Le terminal affiche l'avancement. Vous pouvez fermer le navigateur, ça tourne en fond." },
      { label: "Les offres arrivent", desc: "Chaque offre analysée s'affiche dans la liste avec sa note sur 10." },
    ],
  },
  {
    title: "Score sur 10",
    steps: [
      { label: "Bleu pâle (1 à 5)", desc: "Peu pertinent. L'offre est visible mais pas prioritaire." },
      { label: "Bleu foncé (6 à 10)", desc: "Bon match. CV et lettre sont générés automatiquement." },
      { label: "Voir le détail", desc: "Cliquez sur une fiche pour lire l'analyse complète de JEAN PAUL." },
    ],
  },
  {
    title: "CV et lettre",
    steps: [
      { label: "CV adapté", desc: "PDF personnalisé pour l'offre : tagline et expériences réécrits." },
      { label: "Lettre générée", desc: "Lettre ciblée à lire, copier ou télécharger depuis la fiche." },
      { label: "Langue automatique", desc: "Offre en anglais, CV et lettre en anglais. Offre en français, idem." },
    ],
  },
  {
    title: "Postuler",
    steps: [
      { label: "Cliquez sur Postuler", desc: "Sélectionnez les offres prêtes et lancez l'auto-postulation." },
      { label: "Chromium remplit tout", desc: "Les formulaires LinkedIn sont pré-remplis avec votre CV et votre lettre." },
      { label: "Vous cliquez Submit", desc: "Vous vérifiez, vous validez. Rien n'est envoyé sans vous." },
    ],
  },
  {
    title: "Suivi",
    steps: [
      { label: "Marquer candidaté", desc: "Cochez une fiche pour la marquer manuellement comme dossier candidaté." },
      { label: "Filtrer", desc: "Cliquez sur les pastilles (prêts, candidatés…) pour filtrer la liste." },
      { label: "Boîte à idées", desc: "Une idée d'amélioration ? Soumettez-la dans l'onglet dédié et votez pour les autres." },
    ],
  },
];

export default function DashboardGuide() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="dg">
      <p className="dg__intro">Chaque élément du dashboard, en bref.</p>

      <div className="dg__list">
        {GUIDE.map((section, idx) => {
          const isOpen = open === idx;
          return (
            <section
              key={section.title}
              className={`dg__card${isOpen ? " dg__card--open" : ""}`}
            >
              <button
                type="button"
                className="dg__card-head"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : idx)}
              >
                <span className="dg__card-title">{section.title}</span>
                <span className="dg__card-chevron" aria-hidden="true" />
              </button>

              {isOpen && (
                <div className="dg__card-body">
                  <ol className="dg__timeline">
                    {section.steps.map((step, i) => (
                      <li key={step.label} className="dg__timeline-item">
                        <div className="dg__timeline-rail" aria-hidden="true">
                          <span className="dg__timeline-dot">{i + 1}</span>
                          {i < section.steps.length - 1 && <span className="dg__timeline-line" />}
                        </div>
                        <div className="dg__timeline-content">
                          <strong>{step.label}</strong>
                          <p>{step.desc}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="dg__foot">
        <p>Votre ordinateur doit rester allumé pendant une recherche. Fermer le navigateur, c&apos;est OK.</p>
      </div>
    </div>
  );
}
