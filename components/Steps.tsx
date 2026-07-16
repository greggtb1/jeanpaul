"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { trackEvent } from "@/lib/umami";

const steps = [
  {
    badge: "01",
    title: "Importe ton profil",
    descriptionShort: "Dépose ton CV et précise ta recherche.",
    image: "/profil-config.png",
    imageAlt: "Import de CV et configuration du profil avec expérience et préférences d'emploi",
  },
  {
    badge: "02",
    title: "Recherche",
    descriptionShort: "Offres pertinentes, score de fit sur 10.",
    image: "/radar-recherche.png",
    imageAlt: "BLOW MY JOB scanne LinkedIn, Welcome to the Jungle et Upwork pour trouver les offres pertinentes",
  },
  {
    badge: "03",
    title: "Préparation",
    descriptionShort: "CV, lettre et formulaire générés pour chaque offre.",
    image: "/generation.png",
    imageAlt: "CV et lettre de motivation générés et adaptés à chaque offre",
  },
  {
    badge: "04",
    title: "Remplissage automatique",
    descriptionShort: "Tout est rempli, tu valides.",
    image: "/remplissage.png",
    imageAlt: "Formulaire Doctolib rempli automatiquement avec les informations de Grégoire Linee",
  },
];

const VIDEO_SPEEDS = [
  { rate: 1, label: "×1" },
  { rate: 1.3, label: "×1,3" },
  { rate: 1.5, label: "×1,5" },
] as const;

const DEFAULT_VIDEO_SPEED = 1.3;

export default function Steps() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_VIDEO_SPEED);
  const [showEndCta, setShowEndCta] = useState(false);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

  const setVideoSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = DEFAULT_VIDEO_SPEED;
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnded = () => setShowEndCta(true);
    const onPlay = () => setShowEndCta(false);

    video.addEventListener("ended", onEnded);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("play", onPlay);
    };
  }, []);

  useEffect(() => {
    if (shouldLoadVideo && videoRef.current) {
      videoRef.current.load();
    }
  }, [shouldLoadVideo]);

  useEffect(() => {
    const root = sectionRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const targets = root.querySelectorAll(".step-reveal");
    if (reducedMotion) {
      targets.forEach((el) => el.classList.add("is-visible"));
      setShouldLoadVideo(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            if (entry.target.classList.contains("steps-video")) {
              setShouldLoadVideo(true);
            }
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

        <div className="steps-video step-reveal">
          <div className="steps-video__frame">
            <video
              ref={videoRef}
              className="steps-video__player"
              controls
              playsInline
              preload="none"
              poster="/videos/blowmyjob-demo-poster.jpg"
              controlsList="nodownload noplaybackrate"
            >
              {shouldLoadVideo && (
                <source src="/videos/blowmyjob-demo.mp4" type="video/mp4" />
              )}
              Votre navigateur ne peut pas lire cette vidéo.
            </video>
            <div
              className={`steps-video__endcta${showEndCta ? " is-visible" : ""}`}
              aria-hidden={!showEndCta}
            >
              <Link
                href="/onboarding"
                className="btn btn--cta btn--sm steps-video__cta"
                onClick={() =>
                  trackEvent("landing_cta_click", { source: "steps_video" })
                }
              >
                Commencer
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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
            <div
              className="steps-video__speeds"
              role="group"
              aria-label="Vitesse de lecture"
            >
              {VIDEO_SPEEDS.map(({ rate, label }) => (
                <button
                  key={rate}
                  type="button"
                  className={`steps-video__speed${playbackRate === rate ? " is-active" : ""}`}
                  onClick={() => setVideoSpeed(rate)}
                  aria-pressed={playbackRate === rate}
                  aria-label={`Vitesse ${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="steps-grid">
          {steps.map((step, i) => (
            <div className="steps-grid__item" key={step.badge}>
              {i > 0 && (
                <span className="steps-grid__arrow" aria-hidden="true">
                  →
                </span>
              )}
              <article
                className="step-card step-reveal"
                style={{ "--step-i": i } as React.CSSProperties}
              >
                <span className="step-card__num">{step.badge}</span>
                <figure className="step-card__media">
                  <img src={step.image} alt={step.imageAlt} />
                </figure>
                <h3>{step.title}</h3>
                <p>{step.descriptionShort}</p>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
