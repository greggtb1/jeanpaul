const faqs = [
  {
    q: "Est-ce que je garde le contrôle ?",
    a: "Oui, toujours. Rien n'est envoyé sans votre validation. Vous relisez chaque dossier, ajustez si besoin, puis vous validez.",
  },
  {
    q: "Comment ça marche concrètement ?",
    a: "JEAN PAUL parcourt LinkedIn, sélectionne les offres les plus pertinentes avec un score de fit /10, génère un CV et une lettre adaptés, puis remplit le formulaire automatiquement. Il ne vous reste plus qu'à valider.",
  },
  {
    q: "Est-ce que c'est sécurisé ?",
    a: "Vos données restent les vôtres. Elles servent uniquement à préparer vos dossiers, et rien n'est partagé sans votre accord.",
  },
  {
    q: "Est-ce vraiment automatique ?",
    a: "La recherche, la préparation des documents et le remplissage des formulaires sont automatisés. La décision finale, elle, reste 100 % entre vos mains.",
  },
  {
    q: "Combien de temps pour démarrer ?",
    a: "Quelques minutes. Vous créez votre profil, vous lancez une recherche, et on s'occupe du reste.",
  },
];

export default function Faq() {
  return (
    <section className="section section--alt" id="faq">
      <div className="container">
        <div className="section__head">
          <span className="eyebrow">FAQ</span>
          <h2 className="section__title">Les questions qu&apos;on nous pose</h2>
        </div>

        <div className="faq__list">
          {faqs.map((faq) => (
            <details className="faq__item" key={faq.q}>
              <summary>{faq.q}</summary>
              <p>{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
