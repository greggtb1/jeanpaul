import Link from "next/link";
import Image from "next/image";

const offers = [
  {
    logo: "swile",
    logoClass: "offer__logo--doctolib",
    role: "Product Manager",
    meta: "Swile · Paris, FR",
    score: "9,4",
    scoreClass: "score--green",
  },
  {
    logo: "doctolib",
    logoClass: "offer__logo--doctolib",
    role: "Chargé de Marketing Digital",
    meta: "Doctolib · Paris, FR",
    score: "8,7",
    scoreClass: "score--green",
  },
  {
    logo: "blablacar",
    logoClass: "offer__logo--doctolib",
    role: "UX / Product Designer",
    meta: "BlaBlaCar · Paris, FR",
    score: "8,1",
    scoreClass: "score--green",
  },
  {
    logo: "qonto",
    logoClass: "offer__logo--doctolib",
    role: "Développeur Full-Stack",
    meta: "Qonto · Remote",
    score: "7,6",
    scoreClass: "score--amber",
  },
  {
    logo: "alan",
    logoClass: "offer__logo--doctolib",
    role: "Business Developer",
    meta: "Alan · Paris, FR",
    score: "7,2",
    scoreClass: "score--amber",
  },
];

const formFields = [
  { label: "Prénom", value: "Grégoire Linee" },
  { label: "Email", value: "gregoire.linee@gmail.com" },
  { label: "Téléphone", value: "06 77 50 29 03" },
  { label: "Localisation", value: "Paris, France" },
  { label: "CV", value: "Doctolib_CV_gregoire_linee.pdf" },
  { label: "Lettre de motivation", value: "LM_Doctolib_PM.pdf" },
];

function AirbnbLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 4c1.6 0 2.7 1.3 4 4 1.7 3.5 3 5.6 3 7.4A3.6 3.6 0 0 1 15.4 19c-1.3 0-2.3-.8-3.4-2.6C10.9 18.2 9.9 19 8.6 19A3.6 3.6 0 0 1 5 15.4C5 13.6 6.3 11.5 8 8c1.3-2.7 2.4-4 4-4Z"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlowArrowVertical({ id }: { id: string }) {
  return (
    <div className="mockup__flow-v" aria-hidden="true">
      <svg viewBox="0 0 24 48" width="24" height="48" fill="none">
        <defs>
          <marker
            id={id}
            markerWidth="6"
            markerHeight="6"
            refX="3"
            refY="5"
            orient="auto"
          >
            <path
              d="M0 0 L6 3 L0 6"
              fill="none"
              stroke="#0040f0"
              strokeWidth="1.2"
              strokeOpacity="0.45"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <path
          d="M12 4 L12 40"
          stroke="#0040f0"
          strokeWidth="2"
          strokeDasharray="5 7"
          strokeOpacity="0.3"
          fill="none"
          markerEnd={`url(#${id})`}
        />
      </svg>
    </div>
  );
}

export default function ProductMockup() {
  return (
    <div className="hero__right">
      <svg
        className="flow-arrows"
        viewBox="0 0 900 60"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0 0 L6 3 L0 6" fill="none" stroke="#0040f0" strokeWidth="1.2" strokeOpacity="0.45" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        <path
          d="M150 40 C 260 5, 360 5, 448 38"
          stroke="#0040f0"
          strokeWidth="2"
          strokeDasharray="5 7"
          strokeOpacity="0.3"
          fill="none"
          markerEnd="url(#arrow)"
        />
        <path
          d="M452 40 C 560 5, 660 5, 758 38"
          stroke="#0040f0"
          strokeWidth="2"
          strokeDasharray="5 7"
          strokeOpacity="0.3"
          fill="none"
          markerEnd="url(#arrow)"
        />
      </svg>

      <div className="mockup">
        <article className="pcard">
          <header className="pcard__head">
            <span className="pcard__icon pcard__icon--coral">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="7"
                  width="18"
                  height="13"
                  rx="2.5"
                  stroke="#f03000"
                  strokeWidth="1.8"
                />
                <path
                  d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"
                  stroke="#f03000"
                  strokeWidth="1.8"
                />
              </svg>
            </span>
            <h3>Offres sélectionnées</h3>
          </header>

          <ul className="offers">
            {offers.map((offer, i) => (
              <li key={i} className="offer">
                <span className={`offer__logo ${offer.logoClass}`}>
                  {offer.logo === "airbnb" ? <AirbnbLogo />
                  : offer.logo === "doctolib" ? <Image src="/doctolib.png" alt="Doctolib" width={28} height={28} style={{borderRadius:6, objectFit:"cover"}} />
                  : offer.logo === "blablacar" ? <Image src="/blablacar.png" alt="BlaBlaCar" width={28} height={28} style={{borderRadius:6, objectFit:"cover"}} />
                  : offer.logo === "qonto" ? <Image src="/qonto.png" alt="Qonto" width={28} height={28} style={{borderRadius:6, objectFit:"cover"}} />
                  : offer.logo === "alan" ? <Image src="/alan.png" alt="Alan" width={28} height={28} style={{borderRadius:6, objectFit:"cover"}} />
                  : offer.logo === "swile" ? <Image src="/swile.png" alt="Swile" width={28} height={28} style={{borderRadius:6, objectFit:"cover"}} />
                  : offer.logo}
                </span>
                <div className="offer__info">
                  <p className="offer__role">{offer.role}</p>
                  <p className="offer__meta">{offer.meta}</p>
                </div>
                <span className={`score ${offer.scoreClass}`}>
                  <b>{offer.score}</b>
                  <i>/10</i>
                </span>
              </li>
            ))}
          </ul>

          <Link href="#" className="pcard__link">
            Voir toutes les offres →
          </Link>
        </article>

        <FlowArrowVertical id="arrow-v-1" />

        <article className="pcard">
          <header className="pcard__head">
            <span className="pcard__icon pcard__icon--purple">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 3h7l4 4v14H7V3Z"
                  stroke="#0040f0"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 3v4h4M10 13h5M10 16.5h5"
                  stroke="#0040f0"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <h3>Documents générés</h3>
          </header>

          <div className="doc">
            <span className="doc__file doc__file--coral">PDF</span>
            <div className="doc__info">
              <p className="doc__title">CV adapté</p>
              <p className="doc__name">Doctolib_CV_gregoire_linee.pdf</p>
            </div>
            <span className="badge">Généré ✓</span>
          </div>

          <div className="doc">
            <span className="doc__file doc__file--purple">PDF</span>
            <div className="doc__info">
              <p className="doc__title">Lettre de motivation</p>
              <p className="doc__name">LM_Doctolib_PM.pdf</p>
            </div>
            <span className="badge">Générée ✓</span>
          </div>

          <div className="doc-spark" aria-hidden="true">
            <img src="/cv-lettre.png" alt="" />
          </div>
        </article>

        <FlowArrowVertical id="arrow-v-2" />

        <article className="pcard">
          <header className="pcard__head">
            <span className="pcard__icon pcard__icon--blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2.5"
                  stroke="#0040f0"
                  strokeWidth="1.8"
                />
                <path d="M3 9h18" stroke="#0040f0" strokeWidth="1.8" />
                <circle cx="6" cy="7" r=".9" fill="#0040f0" />
                <circle cx="8.6" cy="7" r=".9" fill="#0040f0" />
              </svg>
            </span>
            <h3>Formulaire rempli automatiquement</h3>
          </header>

          <div className="browser">
            <div className="browser__bar">
              <span className="dot dot--r" />
              <span className="dot dot--y" />
              <span className="dot dot--g" />
              <span className="browser__url">
                careers.doctolib.fr/apply/product-manager
              </span>
            </div>
            <div className="browser__body">
              <div className="browser__job">
                <span className="offer__logo offer__logo--doctolib" style={{padding:0,overflow:"hidden"}}>
                  <Image src="/doctolib.png" alt="Doctolib" width={28} height={28} style={{display:"block",borderRadius:6,objectFit:"cover"}} />
                </span>
                <div className="offer__info">
                  <p className="offer__role">Product Manager</p>
                  <p className="offer__meta">Doctolib</p>
                </div>
              </div>

              {formFields.map((field) => (
                <div key={field.label} className="field">
                  <label>{field.label}</label>
                  <div className="field__input">
                    {field.value} <span className="check">✓</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="callout callout--blue">
            Formulaire rempli automatiquement. Il ne vous reste plus qu&apos;à valider.
          </div>
        </article>
      </div>
    </div>
  );
}
