"use client";
import { useState } from "react";
import { jobs as jobsApi, type Job } from "@/lib/api";

const PLATFORM_ICON: Record<string, string> = {
  linkedin: "🔵", wttj: "🟢", indeed: "🔴",
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new:       { label: "Nouveau",   color: "bg-gray-500/20 text-gray-400" },
  analyzed:  { label: "Analysé",   color: "bg-blue-500/20 text-blue-400" },
  generated: { label: "Généré",    color: "bg-indigo-500/20 text-indigo-400" },
  filled:    { label: "Rempli",    color: "bg-yellow-500/20 text-yellow-400" },
  submitted: { label: "Soumis",    color: "bg-green-500/20 text-green-400" },
  rejected:  { label: "Refusé",    color: "bg-red-500/20 text-red-400" },
  interview: { label: "Entretien", color: "bg-purple-500/20 text-purple-400" },
};

function ScoreBadge({ score }: { score?: number }) {
  if (!score) return null;
  const cls = score >= 8 ? "score-high" : score >= 6 ? "score-mid" : "score-low";
  return <span className={`pill ${cls} text-xs`}>{score}/10</span>;
}

export default function JobCard({ job, onUpdate }: { job: Job; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading]   = useState<string | null>(null);

  const st = STATUS_LABEL[job.status] || { label: job.status, color: "bg-gray-500/20 text-gray-400" };

  async function action(fn: () => Promise<any>, label: string) {
    setLoading(label);
    try { await fn(); onUpdate(); }
    catch (e: any) { alert(e.message); }
    setLoading(null);
  }

  return (
    <div className={`card transition-all ${expanded ? "border-indigo-500/30" : "border-white/[0.05]"}`}>
      <div
        className="flex items-center gap-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Plateforme */}
        <span className="text-xl flex-shrink-0">{PLATFORM_ICON[job.platform] || "⬜"}</span>

        {/* Titre / entreprise */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{job.title}</div>
          <div className="text-xs text-gray-500 truncate">{job.company}{job.location ? ` · ${job.location}` : ""}</div>
        </div>

        {/* Score + status */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ScoreBadge score={job.fit_score} />
          <span className={`pill ${st.color}`}>{st.label}</span>
          {job.cv_url && <span className="text-xs text-green-400" title="CV généré">📄</span>}
          {job.autofill_done && <span className="text-xs text-yellow-400" title="Formulaire rempli">✍️</span>}
        </div>

        <span className="text-gray-600 text-sm">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Panel dépliable */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-white/[0.05]">
          {job.fit_reasoning && (
            <p className="text-sm text-gray-400 mb-4 leading-relaxed">{job.fit_reasoning}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Analyser */}
            {!job.fit_score && (
              <button
                onClick={() => action(() => jobsApi.analyze(job.id), "analyze")}
                disabled={loading === "analyze"}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
              >
                {loading === "analyze" ? "..." : "🧠 Analyser"}
              </button>
            )}

            {/* Générer */}
            {job.fit_score && !job.cv_url && (
              <button
                onClick={() => action(() => jobsApi.generate(job.id), "generate")}
                disabled={loading === "generate"}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors"
              >
                {loading === "generate" ? "..." : "📄 Générer CV + Lettre"}
              </button>
            )}

            {/* Autofill */}
            {job.cv_url && !job.autofill_done && (
              <button
                onClick={() => action(() => jobsApi.autofill(job.id), "autofill")}
                disabled={loading === "autofill"}
                className="text-xs px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 transition-colors"
              >
                {loading === "autofill" ? "..." : "🤖 Remplir formulaire"}
              </button>
            )}

            {/* Télécharger */}
            {job.cv_url && (
              <a href={job.cv_url} target="_blank" rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors">
                ⬇ CV
              </a>
            )}
            {job.letter_url && (
              <a href={job.letter_url} target="_blank" rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors">
                ✉ Lettre
              </a>
            )}

            {/* Voir l'offre */}
            <a href={job.url} target="_blank" rel="noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.05] text-gray-400 hover:text-white transition-colors ml-auto">
              Voir l'offre ↗
            </a>

            {/* Marquer soumis */}
            {job.autofill_done && job.status !== "submitted" && (
              <button
                onClick={() => action(() => jobsApi.update(job.id, { status: "submitted" }), "submit")}
                className="text-xs px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors"
              >
                ✅ Marquer soumis
              </button>
            )}

            {/* Supprimer */}
            <button
              onClick={() => action(() => jobsApi.delete(job.id), "delete")}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
            >
              🗑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
