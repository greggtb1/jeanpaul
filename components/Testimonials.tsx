"use client";

import Link from "next/link";
import { trackEvent } from "@/lib/umami";

const testimonials = [
  {
    quote:
      "Bon ok j'ai pris le max abonnement, mais 110 offres postulées en 40 minutes... c'est juste monstrueux.",
    name: "Camille Renard",
    role: "Product Manager · Paris",
    avatar: "CR",
    avatarColor: "#0040f0",
  },
  {
    quote:
      "Le score de fit m'évite les offres bidon. Et le fait de relire avant l'envoi, ça change tout par rapport aux bots qui spamment.",
    name: "Yanis Benali",
    role: "Développeur front · Lyon",
    avatar: "YB",
    avatarColor: "#f03000",
  },
  {
    quote:
      "J'ai décroché un entretien chez une boîte où je n'aurais jamais pris le temps de postuler à la main. Le CV était vraiment adapté à l'offre.",
    name: "Sofia Martin",
    role: "UX designer · Bordeaux",
    avatar: "SM",
    avatarColor: "#f0b000",
  },
];

export default function Testimonials() {
  return (
    <section className="section section--testi" id="temoignages">
      <div className="container">
        <div className="steps-proof steps-proof--testi is-visible">
          <div className="steps-proof__copy">
            <h3>En 3 minutes, vos candidatures arrivent déjà en boîte mail.</h3>
            <p>
              BLOW MY JOB fait disparaître la corvée.
            </p>
          </div>
          <figure className="steps-proof__media">
            <img
              src="/proofs/postulation.png"
              alt="Boîte mail affichant plusieurs confirmations de candidatures envoyées"
              loading="lazy"
            />
          </figure>
        </div>

        <div className="section__head">
          <span className="eyebrow">Retours terrain</span>
          <h2 className="section__title">Ils postulent sans y passer leurs soirées</h2>
          <p className="section__subtitle">
            Des retours de candidats qui utilisent BLOW MY JOB au quotidien.
          </p>
        </div>

        <div className="testi__grid">
          {testimonials.map((t) => (
            <article className="testi" key={t.name}>
              <p className="testi__quote">&ldquo;{t.quote}&rdquo;</p>
              <div className="testi__person">
                <span
                  className="testi__avatar"
                  style={{ background: t.avatarColor }}
                >
                  {t.avatar}
                </span>
                <div>
                  <p className="testi__name">{t.name}</p>
                  <p className="testi__role">{t.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="section-cta">
          <Link
            href="/onboarding"
            className="btn btn--cta btn--lg"
            onClick={() =>
              trackEvent("landing_cta_click", {
                source: "testimonials",
                cta_label: "Commencer, c'est gratuit",
              })
            }
          >
            Commencer, c&apos;est gratuit
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
