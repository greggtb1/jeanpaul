"use client";

import { useState } from "react";

const FAQ = [
  {
    q: "Comment lancer une recherche ?",
    a: "Sur le tableau de bord, cliquez sur Lancer la recherche. On scanne LinkedIn selon vos critères et on prépare CV + lettre pour les meilleures offres.",
  },
  {
    q: "Où modifier mes critères ?",
    a: "Dans Critères de recherche : métiers, lieux, type de contrat, remote, salaire. Les prochains scans partent de là.",
  },
  {
    q: "À quoi servent les dossiers ?",
    a: "Chaque offre retenue a un score, un CV adapté et une lettre. Ouvrez l’offre, relisez, téléchargez ou postulez.",
  },
  {
    q: "Je n’ai pas de CV ?",
    a: "Pas de souci : au premier scan, on vous demande quelques infos pour calibrer le profil. Vous pourrez ajouter un CV plus tard.",
  },
  {
    q: "Mode découverte ?",
    a: "C’est l’essai gratuit : un premier scan limité pour voir le résultat. Ensuite, un abonnement débloque la suite.",
  },
  {
    q: "Comment postuler ?",
    a: "Sélectionnez les offres prêtes, puis Postuler. Sur ordinateur, l’agent peut remplir les candidatures pour vous.",
  },
];

const CONTACT = "contact@blowmyjob.fr";

export default function AidePage() {
  const [openId, setOpenId] = useState<number | null>(0);

  return (
    <main className="db__main db__main--narrow help-page">
      <header className="db-page-head db-page-head--compact">
        <h1>Aide</h1>
        <p>Réponses courtes. Si ça ne suffit pas, écrivez-nous.</p>
      </header>

      <section className="help-faq" aria-label="Questions fréquentes">
        {FAQ.map((item, i) => {
          const isOpen = openId === i;
          return (
            <div key={item.q} className={`help-faq__item${isOpen ? " is-open" : ""}`}>
              <button
                type="button"
                className="help-faq__q"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : i)}
              >
                <span>{item.q}</span>
                <span className="help-faq__chev" aria-hidden="true">
                  {isOpen ? "−" : "+"}
                </span>
              </button>
              {isOpen && <p className="help-faq__a">{item.a}</p>}
            </div>
          );
        })}
      </section>

      <section className="help-contact">
        <h2>Contact</h2>
        <p>
          Un souci, une question ou une suggestion ?{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </section>
    </main>
  );
}
