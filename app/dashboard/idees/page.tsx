"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type FeatureRequest = {
  id: string;
  message: string;
  votes: number;
  created_at: string;
  mine: boolean;
  voted: boolean;
};

const doneTickets = [
  {
    title: "Coller une URL d'emploi",
    text: "Importer une offre précise depuis LinkedIn, WTTJ, HelloWork ou un autre ATS.",
  },
  {
    title: "Régénérer une lettre en un clic",
    text: "Retoucher la lettre si besoin : plus court, plus humain, plus entreprise ou plus vous.",
  },
  {
    title: "Même logique pour le CV",
    text: "Prévisualiser, télécharger et retoucher le CV adapté à l'offre.",
  },
];

const inProgressTickets = [
  {
    title: "Amélioration auto-apply",
    text: "Rendre le remplissage automatique plus fiable sur davantage de formulaires.",
  },
  {
    title: "Version Windows",
    text: "Préparer le logiciel desktop pour les utilisateurs Windows.",
  },
];

/** Idées utilisateur déjà couvertes par la colonne « Fait » — ne pas les afficher à voter. */
const SHIPPED_IDEA_PATTERNS = [
  /import(er)?\s+(une\s+)?offre|coller\s+une\s+url|url\s+d['']emploi|import\s+par\s+lien|linkedin.*import|wttj.*import/i,
  /r[eé]g[eé]n[eé]rer.*lettre|retouch(er)?.*lettre|lettre\s+en\s+un\s+clic|lettre\s+de\s+motivation/i,
  /m[eê]me\s+logique.*cv|retouch(er)?.*cv|r[eé]g[eé]n[eé]rer.*cv|pr[eé]visuali.*cv|t[eé]l[eé]charg.*cv|modifi(er)?.*cv|cv.*pdf|cv.*enregistrer.*pdf/i,
];

function isShippedIdea(message: string): boolean {
  return SHIPPED_IDEA_PATTERNS.some((re) => re.test(message));
}

export default function IdeesPage() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    const res = await fetch("/api/feedback");
    if (res.ok) {
      const { requests } = await res.json();
      setRequests(requests || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const voteRequests = useMemo(
    () => requests.filter((r) => !isShippedIdea(r.message)),
    [requests]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text.trim() }),
    });
    if (res.ok) {
      setText("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      load();
    } else {
      const d = await res.json();
      setError(d.error || "Erreur");
    }
    setSubmitting(false);
  }

  async function toggleVote(req: FeatureRequest) {
    const vote = req.voted ? "-1" : "1";
    const snapshot = requests;
    setRequests((prev) =>
      prev.map((r) =>
        r.id === req.id
          ? { ...r, voted: !r.voted, votes: r.votes + (req.voted ? -1 : 1) }
          : r
      )
    );
    const res = await fetch(`/api/feedback?vote=${vote}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: req.id }),
    });
    if (!res.ok) {
      setRequests(snapshot);
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Impossible d'enregistrer le vote");
      return;
    }
    const { request } = await res.json();
    if (request) {
      setRequests((prev) =>
        prev.map((r) =>
          r.id === request.id
            ? { ...r, votes: request.votes, voted: request.voted }
            : r
        )
      );
    }
  }

  return (
    <main className="db__main ideas-page">
      <div className="ideas-header">
        <h1 className="ideas-title">Boîte à idées</h1>
        <p className="ideas-sub">
          Votez pour ce qui vous manque le plus, ajoutez vos recos, et je priorise la suite avec vos retours.
        </p>
      </div>

      <form className="ideas-form" onSubmit={submit}>
        <div className="ideas-form-intro">
          <strong>Une idée, une gêne, une feature qui ferait gagner du temps ?</strong>
          <span>Laissez-la ici. Plus une idée reçoit de votes, plus elle remonte dans la roadmap.</span>
        </div>
        <textarea
          ref={textareaRef}
          className="ideas-textarea"
          placeholder="Ex : améliorer tel formulaire, ajouter tel jobboard, retoucher le CV autrement…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          rows={3}
        />
        <div className="ideas-form-foot">
          <span className="ideas-charcount">{text.length}/500</span>
          <button
            type="submit"
            className="ideas-submit"
            disabled={submitting || text.trim().length < 5}
          >
            {submitting ? "Envoi…" : "Soumettre"}
          </button>
        </div>
        {error && <p className="ideas-error">{error}</p>}
        {success && <p className="ideas-ok">Idée envoyée, merci !</p>}
      </form>

      <div className="ideas-kanban" aria-label="Roadmap et idées">
        <section className="ideas-column ideas-column--vote">
          <div className="ideas-column__head">
            <span>À voter</span>
            <strong>{voteRequests.length}</strong>
          </div>
          <div className="ideas-list">
            {loading ? (
              <p className="ideas-loading">Chargement…</p>
            ) : voteRequests.length === 0 ? (
              <p className="ideas-empty">Soyez le premier à proposer une idée à voter.</p>
            ) : (
              voteRequests.map((req) => (
                <div key={req.id} className={`ideas-card${req.mine ? " ideas-card--mine" : ""}`}>
                  <button
                    type="button"
                    className={`ideas-vote${req.voted ? " ideas-vote--active" : ""}`}
                    onClick={() => toggleVote(req)}
                    aria-label={req.voted ? "Annuler mon vote" : "Voter pour cette idée"}
                  >
                    <span className="ideas-vote-arrow">▲</span>
                    <span className="ideas-vote-count">{req.votes}</span>
                  </button>
                  <div className="ideas-card-body">
                    <p className="ideas-card-text">{req.message}</p>
                    {req.mine && <span className="ideas-card-mine">Votre idée</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="ideas-column ideas-column--progress">
          <div className="ideas-column__head">
            <span>En cours</span>
            <strong>{inProgressTickets.length}</strong>
          </div>
          <div className="ideas-list">
            {inProgressTickets.map((ticket) => (
              <article key={ticket.title} className="ideas-card ideas-card--static">
                <span className="ideas-status-dot" aria-hidden="true" />
                <div className="ideas-card-body">
                  <h2 className="ideas-card-title">{ticket.title}</h2>
                  <p className="ideas-card-text">{ticket.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="ideas-column ideas-column--done">
          <div className="ideas-column__head">
            <span>Fait par le développeur</span>
            <strong>{doneTickets.length}</strong>
          </div>
          <div className="ideas-list">
            {doneTickets.map((ticket) => (
              <article key={ticket.title} className="ideas-card ideas-card--static">
                <span className="ideas-status-dot" aria-hidden="true" />
                <div className="ideas-card-body">
                  <h2 className="ideas-card-title">{ticket.title}</h2>
                  <p className="ideas-card-text">{ticket.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
