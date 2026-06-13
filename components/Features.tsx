const features = [
  {
    badge: "Smart matching",
    iconClass: "feature__icon",
    title: "Matching intelligent",
    description:
      "On parcourt LinkedIn pour vous et on garde uniquement les offres qui vous correspondent vraiment, notées /10.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="#0040f0" strokeWidth="1.9" />
        <path
          d="m16.5 16.5 4 4"
          stroke="#0040f0"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    badge: "Auto-apply",
    iconClass: "feature__icon feature__icon--purple",
    title: "Tout est automatisé",
    description:
      "CV, lettre et formulaire sont préparés à votre place. Plus de copier-coller, plus de tâches répétitives.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path
          d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
          stroke="#f03000"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    badge: "Dashboard",
    iconClass: "feature__icon feature__icon--blue",
    title: "Suivi centralisé",
    description:
      "Tous vos dossiers au même endroit, avec leur statut. Vous gardez le contrôle, du début à la fin.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" rx="2" stroke="#f0b000" strokeWidth="1.9" />
        <rect x="13" y="3" width="8" height="5" rx="2" stroke="#f0b000" strokeWidth="1.9" />
        <rect x="13" y="11" width="8" height="10" rx="2" stroke="#f0b000" strokeWidth="1.9" />
        <rect x="3" y="14" width="8" height="7" rx="2" stroke="#f0b000" strokeWidth="1.9" />
      </svg>
    ),
  },
  {
    badge: "Personnalisé",
    iconClass: "feature__icon",
    title: "Documents sur mesure",
    description:
      "Chaque CV et chaque lettre sont adaptés à l'offre. Vous arrivez toujours avec le bon message.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M6 3h8l4 4v14H6V3Z" stroke="#0040f0" strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M14 3v4h4M9 13h6M9 16.5h6" stroke="#0040f0" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    badge: "Notifications",
    iconClass: "feature__icon feature__icon--purple",
    title: "Jamais à la traîne",
    description:
      "On vous prévient dès qu'une offre pertinente tombe. Vous validez en un geste, quand vous voulez.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"
          stroke="#f03000"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <path d="M10 19a2 2 0 0 0 4 0" stroke="#f03000" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    badge: "Sécurisé",
    iconClass: "feature__icon feature__icon--blue",
    title: "Vous gardez le contrôle",
    description:
      "Rien n'est envoyé sans votre accord. Vous relisez, ajustez, puis validez. Toujours.",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"
          stroke="#f0b000"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <path d="m9 12 2 2 4-4" stroke="#f0b000" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function Features() {
  return (
    <section className="section section--alt" id="fonctionnalites">
      <div className="container">
        <div className="section__head">
          <span className="eyebrow">Fonctionnalités</span>
          <h2 className="section__title">Moins d&apos;efforts, plus de résultats</h2>
          <p className="section__subtitle">
            Tout ce qu&apos;il faut pour postuler vite et bien, sans y passer vos soirées.
          </p>
        </div>

        <div className="features__grid">
          {features.map((feature) => (
            <article className="feature" key={feature.title}>
              <span className={feature.iconClass}>{feature.icon}</span>
              <span className="feature__badge">{feature.badge}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
