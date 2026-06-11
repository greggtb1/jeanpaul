"use client";

import { useEffect, useRef, useState } from "react";

type FeatureRequest = {
  id: string;
  message: string;
  votes: number;
  created_at: string;
  mine: boolean;
  voted: boolean;
};

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
          Je développe ce que vous demandez. Soumettez une idée, votez pour les autres.
        </p>
      </div>

      <form className="ideas-form" onSubmit={submit}>
        <textarea
          ref={textareaRef}
          className="ideas-textarea"
          placeholder="Décrivez votre idée ou la feature manquante…"
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

      <div className="ideas-list">
        {loading ? (
          <p className="ideas-loading">Chargement…</p>
        ) : requests.length === 0 ? (
          <p className="ideas-empty">Soyez le premier à soumettre une idée.</p>
        ) : (
          requests.map((req) => (
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
    </main>
  );
}
