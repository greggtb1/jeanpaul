"use client";

const STORAGE_KEY = "jp_first_search_result_tuto_v1";

export function hasSeenFirstSearchDoneTuto(): boolean {
  if (typeof window === "undefined") return true;
  return !!localStorage.getItem(STORAGE_KEY);
}

export function markFirstSearchDoneTutoSeen(): void {
  localStorage.setItem(STORAGE_KEY, "1");
}

export default function FirstSearchDoneTuto({ onClose }: { onClose: () => void }) {
  function close() {
    markFirstSearchDoneTutoSeen();
    onClose();
  }

  return (
    <div className="dob__overlay" role="dialog" aria-modal="true" aria-labelledby="first-done-tuto-title">
      <div className="dob__panel dob__panel--result">
        <button className="dob__close" onClick={close} aria-label="Fermer">
          ✕
        </button>

        <div className="dob__icon" aria-hidden="true">
          🎉
        </div>
        <h2 id="first-done-tuto-title" className="dob__title">
          Votre première recherche est terminée
        </h2>
        <ul className="dob__result-list">
          <li>
            <strong>Vos offres</strong> sont listées ci-dessous avec le CV et la lettre déjà générés pour
            chaque match.
          </li>
          <li>
            <strong>Cliquez sur une offre</strong> pour voir pourquoi elle vous correspond (score et analyse).
          </li>
          <li>
            <strong>Cliquez sur Postuler</strong> en haut : JEAN PAUL ouvre les formulaires et remplit les champs
            automatiquement. Vous n&apos;avez plus qu&apos;à valider l&apos;envoi.
          </li>
        </ul>

        <div className="dob__nav dob__nav--single">
          <button type="button" className="dob__btn-next dob__btn-next--done" onClick={close}>
            OK, c&apos;est compris
          </button>
        </div>
      </div>
    </div>
  );
}
