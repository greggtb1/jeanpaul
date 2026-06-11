"use client";

import { useEffect, useRef } from "react";

const steps = [
  {
    badge: "01",
    title: "Importe ton profil",
    description:
      "Tu déposes ton CV, tu précises ce que tu cherches. JEAN PAUL a tout ce qu'il faut pour postuler à ta place.",
    image: "/profil-config.png",
    imageAlt: "Import de CV et configuration du profil avec expérience et préférences d'emploi",
  },
  {
    badge: "02",
    title: "Recherche",
    description:
      "On scanne LinkedIn et on te remonte uniquement les offres qui matchent, avec un score de fit sur 10.",
    image: "/radar-recherche.png",
    imageAlt: "JEAN PAUL scanne LinkedIn, Welcome to the Jungle et Upwork pour trouver les offres pertinentes",
  },
  {
    badge: "03",
    title: "Préparation",
    description:
      "CV, lettre et formulaire sont générés pour chaque offre. Plus de copier-coller, plus de soirées perdues.",
    image: "/generation.png",
    imageAlt: "CV et lettre de motivation générés et adaptés à chaque offre",
  },
  {
    badge: "04",
    title: "Validation",
    description:
      "Tu relis, tu modifies si besoin, tu valides. Rien ne part sans ton accord.",
    image: "/remplissage.png",
    imageAlt: "Formulaire Doctolib rempli automatiquement avec les informations de Grégoire Linee",
  },
];

export default function Steps() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = sectionRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const targets = root.querySelectorAll(".step-reveal");
    if (reducedMotion) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="section section--steps"
      id="fonctionnement"
    >
      <div className="container">
        <div className="section__head step-reveal">
          <span className="eyebrow">Comment ça marche</span>
          <h2 className="section__title">Quatre étapes, zéro corvée</h2>
          <p className="section__subtitle">
            Un geste simple de votre part, le reste est automatisé.
          </p>
        </div>

        <div className="steps-showcase">
          <div className="steps-rail step-reveal" aria-hidden="true" />
          {steps.map((step, i) => (
            <article
              className={`step-row step-reveal${i % 2 === 1 ? " step-row--reverse" : ""}${i >= 2 ? " step-row--tall" : ""}`}
              key={step.badge}
              style={{ "--step-i": i } as React.CSSProperties}
            >
              <figure className="step-row__media">
                <img src={step.image} alt={step.imageAlt} />
              </figure>
              <div className="step-row__copy">
                <span className="step-row__num">{step.badge}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
