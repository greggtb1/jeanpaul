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
        <div className="section__head">
          <span className="eyebrow">Retours terrain</span>
          <h2 className="section__title">Ils postulent sans y passer leurs soirées</h2>
          <p className="section__subtitle">
            Des retours de candidats qui utilisent JEAN PAUL au quotidien.
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
      </div>
    </section>
  );
}
