"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

const NAV = [
  { href: "#benefices", label: "Bénéfices" },
  { href: "#fonctionnement", label: "Fonctionnement" },
  { href: "#etudiants", label: "Vos étudiants" },
  { href: "#offre", label: "Offre" },
  { href: "#faq", label: "FAQ" },
];

const HERO_STATS = [
  { value: "×3", label: "d'entretiens décrochés par vos étudiants" },
  { value: "6 h", label: "économisées / semaine et par étudiant" },
];

const PARTNER_INITIALS = ["EM", "IE", "IAE", "BC", "EN"];

const CATEGORIES = [
  "Écoles de commerce",
  "Écoles d'ingénieurs",
  "IAE & Universités",
  "Bachelors & Masters",
  "Career centers",
];

const BENEFITS = [
  {
    icon: "chart",
    title: "Boostez votre taux d'insertion",
    text: "L'employabilité est votre meilleur argument. Vos étudiants trouvent plus vite leurs stages et alternances, postulent mieux, et vos indicateurs suivent.",
  },
  {
    icon: "star",
    title: "Un avantage différenciant",
    text: "Offrez à chaque promotion un outil premium que les autres établissements n'ont pas. Un argument fort dès les journées portes ouvertes.",
  },
  {
    icon: "bolt",
    title: "Zéro charge pour vos équipes",
    text: "Aucune surcharge pour votre career center. On déploie, on accompagne, on assure le support. Vous gardez la main sur le pilotage.",
  },
  {
    icon: "gauge",
    title: "Tableau de bord établissement",
    text: "Suivez l'adoption et l'impact de façon anonymisée : activations, candidatures envoyées, entretiens déclarés, par promotion.",
  },
  {
    icon: "shield",
    title: "Conforme & sécurisé",
    text: "Hébergement européen, données chiffrées, conformité RGPD. Vos étudiants restent maîtres de leurs informations.",
  },
  {
    icon: "brush",
    title: "Marque blanche possible",
    text: "Aux couleurs de votre établissement : logo, domaine, e-mails. Une expérience intégrée à votre écosystème carrière.",
  },
];

const STEPS = [
  {
    num: "01",
    title: "On configure votre espace",
    text: "Espace établissement dédié, aux couleurs de votre école, prêt en quelques jours. Vous définissez les promotions concernées.",
  },
  {
    num: "02",
    title: "Vos étudiants activent leur accès",
    text: "Ils s'inscrivent avec leur e-mail @votre-école et débloquent l'accès complet, gratuitement. Rien à installer.",
  },
  {
    num: "03",
    title: "Vous suivez l'impact",
    text: "Tableau de bord temps réel : adoption, candidatures, entretiens. De la donnée concrète pour vos rapports d'insertion.",
  },
];

const STUDENT_FEATURES = [
  "Accompagnement pour décrocher stages, alternances et premiers emplois",
  "Scan des offres qui matchent leur profil, avec un score de pertinence /10",
  "CV et lettre générés et optimisés pour chaque offre",
  "Candidature soumise automatiquement, ils valident avant l'envoi",
  "Optimisé pour passer les filtres IA des recruteurs (ATS)",
  "Suivi centralisé de toutes leurs candidatures",
];

const OFFER_INCLUDED = [
  "Accès complet illimité pour tous les étudiants concernés",
  "Espace & marque blanche à vos couleurs",
  "Tableau de bord établissement + rapports d'insertion",
  "Onboarding, ateliers et support dédiés",
  "Accompagnement d'un référent dédié",
];

const FAQ = [
  {
    q: "Combien ça coûte pour l'établissement ?",
    a: "Une licence annuelle par établissement, calibrée sur le nombre d'étudiants concernés. Le tarif est dégressif au volume et l'accès est 100 % gratuit pour vos étudiants. On établit un devis sur mesure après un échange.",
  },
  {
    q: "Combien de temps pour déployer ?",
    a: "Quelques jours. On crée votre espace, on le personnalise à vos couleurs, et vos étudiants peuvent activer leur accès immédiatement avec leur e-mail institutionnel.",
  },
  {
    q: "Et la protection des données (RGPD) ?",
    a: "Hébergement en Europe, données chiffrées, conformité RGPD. Les statistiques transmises à l'établissement sont agrégées et anonymisées. Chaque étudiant reste propriétaire de ses données.",
  },
  {
    q: "Est-ce personnalisable à notre marque ?",
    a: "Oui, en marque blanche : logo, nom de domaine, e-mails et charte graphique de votre établissement.",
  },
];

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".pro-reveal"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

function Icon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16M8 15l3-4 3 3 4-6" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="m12 3 2.6 5.6L21 9.3l-4.5 4.2 1.1 6.1L12 16.9 6.4 19.6l1.1-6.1L3 9.3l6.4-.7L12 3Z" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case "gauge":
      return (
        <svg {...common}>
          <path d="M12 13 15 9M3.5 15a8.5 8.5 0 1 1 17 0" />
          <circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "brush":
      return (
        <svg {...common}>
          <path d="M4 20c0-2 1-3 3-3s3 1 3 3-2 2-4 2-2-1-2-2Z" />
          <path d="M10 17 20 7a2 2 0 0 0-3-3L7 14" />
        </svg>
      );
    default:
      return null;
  }
}

export default function ProLanding() {
  useReveal();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const subject = encodeURIComponent(
      `Demande de démo Campus : ${f.get("school") || ""}`
    );
    const body = encodeURIComponent(
      [
        `Établissement : ${f.get("school") || ""}`,
        `Contact : ${f.get("name") || ""}`,
        `E-mail : ${f.get("email") || ""}`,
        `Nombre d'étudiants : ${f.get("students") || ""}`,
        "",
        `${f.get("message") || ""}`,
      ].join("\n")
    );
    window.location.href = `mailto:contact@blowmyjob.fr?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <div className="pro-shell">
      <div className="pro-bg" aria-hidden="true" />

      <header className="pro-header">
        <Link href="/pro" className="pro-brand" onClick={() => setOpen(false)}>
          <img src="/logo.png" alt="" width={40} height={40} />
          <span className="pro-brand__name">
            Campus
            <span className="pro-brand__tag">Employabilité</span>
          </span>
        </Link>

        <nav className="pro-nav pro-nav--desktop">
          {NAV.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="pro-header__actions">
          <a href="#demo" className="btn btn--accent btn--sm">
            Demander une démo
          </a>
          <button
            type="button"
            className="pro-burger"
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        {open && (
          <nav className="pro-nav pro-nav--mobile">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </a>
            ))}
            <a
              href="#demo"
              className="btn btn--accent btn--sm"
              onClick={() => setOpen(false)}
            >
              Demander une démo
            </a>
          </nav>
        )}
      </header>

      {/* HERO */}
      <section className="pro-hero">
        <div className="pro-hero__inner">
          <div className="pro-hero__copy pro-reveal">
            <span className="pro-eyebrow pro-eyebrow--light">
              Pour les écoles de commerce & l&apos;enseignement supérieur
            </span>
            <h1 className="pro-hero__title">
              L&apos;employabilité de vos étudiants,
              <br />
              <span className="pro-mark-group">
                <mark className="pro-mark">votre plus bel</mark>
                <mark className="pro-mark">argument.</mark>
              </span>
            </h1>
            <p className="pro-hero__sub">
              Notre plateforme accompagne vos étudiants à trouver leurs stages et
              leurs alternances : repérage des offres, CV et lettres sur mesure,
              candidatures envoyées pour eux. Vous l&apos;offrez gratuitement à vos
              promotions, ils décrochent plus d&apos;entretiens, et vos indicateurs
              d&apos;insertion s&apos;envolent.
            </p>
            <div className="pro-hero__cta">
              <a href="#demo" className="btn btn--accent btn--lg">
                Réserver une démo
              </a>
              <a href="#fonctionnement" className="btn btn--navy btn--lg">
                Voir la solution
              </a>
            </div>

            <div className="pro-hero__stats">
              {HERO_STATS.map((s) => (
                <div className="pro-hero__stat" key={s.label}>
                  <strong>{s.value}</strong>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dashboard mockup */}
          <div className="pro-hero__visual pro-reveal">
            <div className="pro-dash">
              <div className="pro-dash__bar">
                <span className="pro-dash__dot" />
                <span className="pro-dash__dot" />
                <span className="pro-dash__dot" />
                <span className="pro-dash__title">Espace établissement</span>
              </div>
              <div className="pro-dash__body">
                <div className="pro-dash__kpis">
                  <div className="pro-dash__kpi">
                    <span className="pro-dash__kpi-val">1 240</span>
                    <span className="pro-dash__kpi-lbl">étudiants actifs</span>
                  </div>
                  <div className="pro-dash__kpi pro-dash__kpi--accent">
                    <span className="pro-dash__kpi-val">18 730</span>
                    <span className="pro-dash__kpi-lbl">candidatures envoyées</span>
                  </div>
                  <div className="pro-dash__kpi">
                    <span className="pro-dash__kpi-val">2 106</span>
                    <span className="pro-dash__kpi-lbl">entretiens déclarés</span>
                  </div>
                </div>
                <div className="pro-dash__chart" aria-hidden="true">
                  {[38, 52, 47, 66, 61, 78, 72, 90].map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="pro-dash__row">
                  <div className="pro-dash__promo">
                    <span>Promo Master 1, Marketing</span>
                    <div className="pro-dash__prog"><i style={{ width: "82%" }} /></div>
                  </div>
                  <div className="pro-dash__promo">
                    <span>Promo Master 2, Finance</span>
                    <div className="pro-dash__prog"><i style={{ width: "67%" }} /></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="pro-badge pro-badge--float">
              <Icon name="shield" />
              Conforme RGPD · Hébergé en Europe
            </div>
          </div>
        </div>

        <div className="pro-band pro-reveal">
          <span className="pro-band__label">Conçu pour</span>
          <div className="pro-band__items">
            {CATEGORIES.map((c) => (
              <span className="pro-band__chip" key={c}>
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="pro-proof pro-reveal" aria-label="Résultats chez nos établissements partenaires">
        <div className="pro-proof__card">
          <div className="pro-proof__left">
            <span className="pro-proof__eyebrow">Les écoles qui nous utilisent</span>
            <div className="pro-proof__avatars" aria-hidden="true">
              {PARTNER_INITIALS.map((initials, i) => (
                <span className="pro-proof__avatar" key={initials} style={{ zIndex: PARTNER_INITIALS.length - i }}>
                  {initials}
                </span>
              ))}
              <span className="pro-proof__avatar pro-proof__avatar--more">+</span>
            </div>
            <p className="pro-proof__caption">
              Écoles de commerce, ingénieurs et universités partout en France
            </p>
          </div>

          <div className="pro-proof__metric">
            <div className="pro-proof__ring" aria-hidden="true">
              <svg viewBox="0 0 120 120" fill="none">
                <circle cx="60" cy="60" r="52" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  stroke="url(#pro-proof-grad)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray="326.5"
                  strokeDashoffset="0.98"
                  transform="rotate(-90 60 60)"
                />
                <defs>
                  <linearGradient id="pro-proof-grad" x1="0" y1="0" x2="120" y2="120">
                    <stop stopColor="#5b8cff" />
                    <stop offset="1" stopColor="#0040f0" />
                  </linearGradient>
                </defs>
              </svg>
              <strong>99,7&nbsp;%</strong>
            </div>
            <div className="pro-proof__copy">
              <p className="pro-proof__stat-label">d&apos;employabilité en sortie de promotion</p>
              <p className="pro-proof__stat-note">
                Moyenne constatée chez les établissements partenaires sur la dernière promotion diplômée.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="pro-section" id="benefices">
        <div className="pro-section__head pro-reveal">
          <span className="pro-eyebrow">Pourquoi votre établissement</span>
          <h2 className="pro-h2">Un levier d&apos;employabilité, clé en main.</h2>
          <p className="pro-lead">
            Vous investissez dans la réussite de vos étudiants, de la recherche de
            stage à l&apos;alternance puis au premier emploi. Nous transformons cet
            investissement en résultats mesurables.
          </p>
        </div>
        <div className="pro-grid">
          {BENEFITS.map((b) => (
            <article className="pro-card pro-reveal" key={b.title}>
              <span className="pro-card__icon">
                <Icon name={b.icon} />
              </span>
              <h3>{b.title}</h3>
              <p>{b.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="pro-section pro-section--dark" id="fonctionnement">
        <div className="pro-section__head pro-reveal">
          <span className="pro-eyebrow pro-eyebrow--light">Déploiement</span>
          <h2 className="pro-h2 pro-h2--light">
            Opérationnel en quelques jours, sans effort côté équipes.
          </h2>
        </div>
        <div className="pro-steps">
          {STEPS.map((s) => (
            <article className="pro-step pro-reveal" key={s.num}>
              <span className="pro-step__num">{s.num}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* STUDENT VALUE */}
      <section className="pro-section" id="etudiants">
        <div className="pro-split">
          <div className="pro-split__copy pro-reveal">
            <span className="pro-eyebrow">Ce que reçoivent vos étudiants</span>
            <h2 className="pro-h2">Un assistant de carrière, offert.</h2>
            <p className="pro-lead">
              Stages, alternances ou CDI : pendant que vos étudiants se concentrent
              sur leurs études, la plateforme s&apos;occupe de la recherche, de la
              rédaction et de la postulation. Ils gardent le contrôle, valident, et
              candidatent 10× plus vite.
            </p>
            <ul className="pro-checklist">
              {STUDENT_FEATURES.map((f) => (
                <li key={f}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" fill="var(--accent)" />
                    <path d="m8 12 2.5 2.5L16 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="pro-split__media pro-reveal">
            <div className="pro-quote">
              <p className="pro-quote__text">
                &ldquo;On cherchait un vrai plus employabilité à mettre en avant
                auprès des candidats et des classements. Le déploiement a été bluffant
                de simplicité, et l&apos;engagement des étudiants au-dessus de nos
                attentes.&rdquo;
              </p>
              <div className="pro-quote__author">
                <Image
                  src="/images/claire-lemoine.png"
                  alt="Claire Lemoine"
                  width={52}
                  height={52}
                  className="pro-quote__avatar"
                />
                <div>
                  <strong>Claire Lemoine</strong>
                  <span>Directrice des relations entreprises · Grande école de commerce</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OFFER */}
      <section className="pro-section pro-section--alt" id="offre">
        <div className="pro-section__head pro-reveal">
          <span className="pro-eyebrow">L&apos;offre établissement</span>
          <h2 className="pro-h2">Une licence, tous vos étudiants.</h2>
          <p className="pro-lead">
            Un modèle simple : vous prenez une licence annuelle, l&apos;accès est gratuit
            et illimité pour vos étudiants.
          </p>
        </div>

        <div className="pro-offer pro-reveal">
          <div className="pro-offer__main">
            <span className="pro-offer__label">Licence établissement</span>
            <div className="pro-offer__price">
              <span className="pro-offer__from">à partir de</span>
              <strong>Sur devis</strong>
              <span className="pro-offer__unit">tarif dégressif au volume</span>
            </div>
            <ul className="pro-offer__list">
              {OFFER_INCLUDED.map((i) => (
                <li key={i}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="m5 12 5 5L19 7" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {i}
                </li>
              ))}
            </ul>
            <a href="#demo" className="btn btn--accent btn--lg btn--full">
              Demander un devis
            </a>
          </div>
          <div className="pro-offer__side">
            <span className="pro-offer__pilot-badge">Sans engagement</span>
            <h3>Programme pilote gratuit</h3>
            <p>
              Testez la solution sur une promotion, mesurez l&apos;adoption et l&apos;impact
              réels, puis décidez. Zéro risque, zéro coût pour démarrer.
            </p>
            <a href="#demo" className="btn btn--navy btn--full">
              Lancer un pilote
            </a>
          </div>
        </div>
      </section>

      {/* DEMO CTA + FORM */}
      <section className="pro-cta" id="demo">
        <div className="pro-cta__inner pro-reveal">
          <div className="pro-cta__copy">
            <h2>Offrez à vos étudiants une longueur d&apos;avance.</h2>
            <p>
              20 minutes suffisent pour vous montrer la solution, l&apos;espace
              établissement et le potentiel sur vos indicateurs d&apos;insertion.
            </p>
            <ul className="pro-cta__points">
              <li>Démo personnalisée à votre établissement</li>
              <li>Estimation d&apos;impact & devis sur mesure</li>
              <li>Programme pilote gratuit à la clé</li>
            </ul>
          </div>

          <form ref={formRef} className="pro-form" onSubmit={onSubmit}>
            {sent ? (
              <div className="pro-form__done">
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" fill="var(--accent)" />
                  <path d="m7 12 3.2 3.2L17 8.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <h3>Votre e-mail est prêt à partir</h3>
                <p>
                  Votre logiciel de messagerie s&apos;est ouvert avec votre demande.
                  Sinon, écrivez-nous à contact@blowmyjob.fr, on revient vers vous
                  sous 24 h.
                </p>
              </div>
            ) : (
              <>
                <h3 className="pro-form__title">Demander une démo</h3>
                <div className="pro-form__grid">
                  <label>
                    Nom & prénom
                    <input name="name" type="text" required placeholder="Jean Dupont" />
                  </label>
                  <label>
                    Établissement
                    <input name="school" type="text" required placeholder="Nom de votre école" />
                  </label>
                  <label>
                    E-mail professionnel
                    <input name="email" type="email" required placeholder="prenom@votre-ecole.fr" />
                  </label>
                  <label>
                    Nombre d&apos;étudiants
                    <input name="students" type="text" inputMode="numeric" placeholder="ex. 1 200" />
                  </label>
                </div>
                <label className="pro-form__full">
                  Votre besoin (optionnel)
                  <textarea name="message" rows={3} placeholder="Contexte, promotions visées, échéance…" />
                </label>
                <button type="submit" className="btn btn--accent btn--lg btn--full">
                  Envoyer ma demande
                </button>
                <p className="pro-form__legal">
                  En envoyant, vous acceptez d&apos;être recontacté au sujet de votre demande.
                </p>
              </>
            )}
          </form>
        </div>
      </section>

      {/* FAQ */}
      <section className="pro-section" id="faq">
        <div className="pro-section__head pro-reveal">
          <span className="pro-eyebrow">Questions fréquentes</span>
          <h2 className="pro-h2">Tout ce que veulent savoir les établissements.</h2>
        </div>
        <div className="pro-faq pro-reveal">
          {FAQ.map((item) => (
            <details className="pro-faq__item" key={item.q}>
              <summary>
                {item.q}
                <span className="pro-faq__plus" aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="pro-footer">
        <div className="pro-footer__inner">
          <span className="pro-footer__brand">Campus · Employabilité</span>
          <nav className="pro-footer__links" aria-label="Liens légaux">
            <Link href="/cgu">CGU</Link>
            <Link href="/confidentialite">Confidentialité</Link>
            <a href="mailto:contact@blowmyjob.fr">Contact</a>
          </nav>
        </div>
        <p className="pro-footer__copy" suppressHydrationWarning>
          © {new Date().getFullYear()} Campus
        </p>
      </footer>
    </div>
  );
}
