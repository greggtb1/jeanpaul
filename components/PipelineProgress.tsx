"use client";

import { useMemo } from "react";
import type { PipelineRun } from "@/components/PipelineLog";
import { getPipelineSteps, parsePipelinePhase } from "@/lib/pipeline-phase";

function statPrimary(phase: ReturnType<typeof parsePipelinePhase>): { val: string; lbl: string } {
  const { subPhase, queriesDone, queriesTotal, descCurrent, descTotal, offersNew, offersThisQuery, analyzeDone, analyzeTotal, qualifying, generated, generateMax, autoapplyCurrent, autoapplyTotal, autoapplyReady } = phase;

  if (subPhase === "autoapply_boot" || subPhase === "autoapply_fill" || subPhase === "autoapply_ready") {
    return {
      val: autoapplyTotal
        ? `${autoapplyReady || autoapplyCurrent || 0}/${autoapplyTotal}`
        : String(autoapplyCurrent || "…"),
      lbl: "Onglets",
    };
  }
  if (subPhase === "scrape_query" || subPhase === "scrape_prepare" || subPhase === "boot") {
    return {
      val: queriesTotal ? `${queriesDone}/${queriesTotal}` : String(queriesDone || "…"),
      lbl: "Requêtes",
    };
  }
  if (subPhase === "scrape_desc") {
    return { val: descTotal ? `${descCurrent}/${descTotal}` : "…", lbl: "Descriptions" };
  }
  if (subPhase === "scrape_done") {
    return { val: String(offersNew || "…"), lbl: "Nouvelles offres" };
  }
  if (subPhase === "analyze" || subPhase === "hunt_fill") {
    return {
      val: analyzeTotal ? `${analyzeDone}/${analyzeTotal}` : String(analyzeDone || "…"),
      lbl: "Analysées",
    };
  }
  if (subPhase === "generate" || subPhase === "sync" || subPhase === "done") {
    return { val: generated ? `${generated}/${generateMax}` : "…", lbl: "Candidatures" };
  }
  return { val: String(offersThisQuery || "…"), lbl: "Cette requête" };
}

function statSecondary(phase: ReturnType<typeof parsePipelinePhase>): { val: string; lbl: string } | null {
  const { subPhase, offersThisQuery, offersNew, offersTotal, qualifying, maxPerQuery, formPage } = phase;

  if (subPhase === "autoapply_fill" && formPage > 0) return { val: String(formPage), lbl: "Page formulaire" };
  if (subPhase === "autoapply_ready") return { val: "Manuel", lbl: "Clique Submit" };
  if (subPhase === "scrape_query") return { val: String(offersThisQuery || 0), lbl: `Offres (max ${maxPerQuery})` };
  if (subPhase === "scrape_desc") return { val: String(offersThisQuery || 0), lbl: "Sur cette requête" };
  if (subPhase === "scrape_done") return { val: String(offersTotal || "…"), lbl: "Total en base" };
  if (subPhase === "analyze" || subPhase === "hunt_fill") return { val: String(qualifying), lbl: "≥ 6/10" };
  if (subPhase === "generate") return { val: String(qualifying || offersNew), lbl: "Éligibles" };
  return null;
}

function AutoApplyValidateCallout({ count }: { count: number }) {
  return (
    <div className="db-auto-validate" role="status" aria-live="polite">
      <div className="db-auto-validate__icon" aria-hidden="true">🪟</div>
      <div className="db-auto-validate__body">
        <p className="db-auto-validate__title">Validez vos candidatures dans Chromium</p>
        <p className="db-auto-validate__text">
          {count > 1
            ? `${count} onglets sont ouverts avec les formulaires pré-remplis.`
            : "Un onglet est ouvert avec le formulaire pré-rempli."}{" "}
          Passez sur chaque offre, vérifiez le CV et cliquez « Envoyer la candidature ».
        </p>
        <p className="db-auto-validate__hint">Fermez la fenêtre Chromium quand vous avez tout envoyé.</p>
      </div>
    </div>
  );
}

export default function PipelineProgress({
  run,
  jobsFound = 0,
  targetRoles,
  compact = false,
  onStop,
  stopping,
}: {
  run: PipelineRun | null;
  jobsFound?: number;
  targetRoles?: string[] | null;
  compact?: boolean;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const phase = useMemo(() => parsePipelinePhase(run, jobsFound), [run, jobsFound]);
  const steps = getPipelineSteps(phase.mode);
  const primary = statPrimary(phase);
  const secondary = statSecondary(phase);

  const autoapply = run?.result?.mode === "autoapply" || /auto.?apply|auto.?postul/i.test(run?.log || "");
  const analyzeOnly = /Reprise\s*:\s*analyse|sans scraping/i.test(run?.log || "");
  const awaitingValidation = phase.subPhase === "autoapply_ready";

  const eyebrow = awaitingValidation
    ? "Dernière étape"
    : autoapply
      ? "Auto-postulation en cours"
      : analyzeOnly
        ? "Analyse en cours"
        : "Recherche en cours";

  const stopLabel = autoapply
    ? "Stopper l'auto-postulation"
    : analyzeOnly
      ? "Stopper l'analyse"
      : "Stopper la recherche";

  if (compact) {
    return (
      <section className="db-pipeline-live db-pipeline-live--compact" aria-live="polite">
        {phase.subPhase === "autoapply_ready" && (
          <AutoApplyValidateCallout count={phase.autoapplyTotal || phase.autoapplyReady || 1} />
        )}
        <div className="db-pipeline-live__compact-row">
          <div className="db-pipeline-live__compact-left">
            <span className="db-pipeline-live__compact-eyebrow">{eyebrow}</span>
            <span className="db-pipeline-live__compact-step">
              Étape {phase.step || 1}/{steps.length} · {phase.stepLabel}
            </span>
            <span className="db-pipeline-live__compact-detail">{phase.detail}</span>
          </div>
          <div className="db-pipeline-live__compact-right">
            <span className="db-pipeline-live__pct">{phase.progress}%</span>
            {onStop && (
              <button
                type="button"
                className="btn--stop-search"
                disabled={stopping}
                onClick={onStop}
              >
                {stopping ? "Arrêt…" : stopLabel}
              </button>
            )}
          </div>
        </div>
        <div className="db-pipeline-live__bar" aria-hidden="true">
          <span style={{ width: `${phase.progress}%` }} />
        </div>
      </section>
    );
  }

  return (
    <section className="db-pipeline-live" aria-live="polite">
      {phase.subPhase === "autoapply_ready" && (
        <AutoApplyValidateCallout count={phase.autoapplyTotal || phase.autoapplyReady || 1} />
      )}
      <header className="db-pipeline-live__top">
        <div className="db-pipeline-live__top-body">
          <p className="db-pipeline-live__eyebrow">{eyebrow}</p>
          <h3 className="db-pipeline-live__title">{phase.detail}</h3>
          <p className="db-pipeline-live__sub">
            Étape {phase.step || 1} / {steps.length} · {phase.stepLabel}
          </p>
          {phase.subdetail && <p className="db-pipeline-live__sub">{phase.subdetail}</p>}
        </div>
        <div className="db-pipeline-live__top-aside">
          <span className="db-pipeline-live__pct">{phase.progress}%</span>
          {onStop && (
            <button
              type="button"
              className="btn--stop-search"
              disabled={stopping}
              onClick={onStop}
            >
              {stopping ? "Arrêt…" : stopLabel}
            </button>
          )}
        </div>
      </header>

      <div className="db-pipeline-live__bar" aria-hidden="true">
        <span style={{ width: `${phase.progress}%` }} />
      </div>

      <ol className="db-pipeline-live__steps">
        {steps.map((s) => {
          const state = phase.step > s.id ? "done" : phase.step === s.id ? "active" : "pending";
          return (
            <li key={s.id} className={`db-pipeline-live__step db-pipeline-live__step--${state}`}>
              <span className="db-pipeline-live__step-num">{state === "done" ? "✓" : s.id}</span>
              <span className="db-pipeline-live__step-label">{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="db-pipeline-live__stats">
        <div className="db-pipeline-live__stat">
          <span className="db-pipeline-live__stat-val">{primary.val}</span>
          <span className="db-pipeline-live__stat-lbl">{primary.lbl}</span>
        </div>
        {secondary && (
          <div className="db-pipeline-live__stat">
            <span className="db-pipeline-live__stat-val">{secondary.val}</span>
            <span className="db-pipeline-live__stat-lbl">{secondary.lbl}</span>
          </div>
        )}
        {targetRoles?.length ? (
          <div className="db-pipeline-live__stat db-pipeline-live__stat--wide">
            <span className="db-pipeline-live__stat-lbl">Postes cibles</span>
            <span className="db-pipeline-live__stat-tags">
              {targetRoles.slice(0, 4).map((r) => (
                <span key={r} className="db-pipeline-live__tag">{r}</span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
