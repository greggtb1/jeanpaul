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
      lbl: "onglets",
    };
  }
  if (subPhase === "scrape_query" || subPhase === "scrape_prepare" || subPhase === "boot") {
    return {
      val: queriesTotal ? `${queriesDone}/${queriesTotal}` : String(queriesDone || "…"),
      lbl: "requêtes",
    };
  }
  if (subPhase === "scrape_desc") {
    return { val: descTotal ? `${descCurrent}/${descTotal}` : "…", lbl: "descriptions" };
  }
  if (subPhase === "scrape_done") {
    return { val: String(offersNew || "…"), lbl: "nouvelles offres" };
  }
  if (subPhase === "analyze" || subPhase === "hunt_fill") {
    return {
      val: analyzeTotal ? `${analyzeDone}/${analyzeTotal}` : String(analyzeDone || "…"),
      lbl: "analysées",
    };
  }
  if (subPhase === "generate" || subPhase === "sync" || subPhase === "done") {
    return { val: generated ? `${generated}/${generateMax}` : "…", lbl: "candidatures" };
  }
  return { val: String(offersThisQuery || "…"), lbl: "cette requête" };
}

function statSecondary(phase: ReturnType<typeof parsePipelinePhase>): { val: string; lbl: string } | null {
  const { subPhase, offersThisQuery, offersNew, offersTotal, qualifying, maxPerQuery, formPage } = phase;

  if (subPhase === "autoapply_fill" && formPage > 0) return { val: String(formPage), lbl: "page formulaire" };
  if (subPhase === "autoapply_ready") return { val: "Manuel", lbl: "clique Submit" };
  if (subPhase === "scrape_query") return { val: String(offersThisQuery || 0), lbl: `offres (max ${maxPerQuery})` };
  if (subPhase === "scrape_desc") return { val: String(offersThisQuery || 0), lbl: "sur cette requête" };
  if (subPhase === "scrape_done") return { val: String(offersTotal || "…"), lbl: "en base" };
  if (subPhase === "analyze" || subPhase === "hunt_fill") return { val: String(qualifying), lbl: "≥ 6/10" };
  if (subPhase === "generate") return { val: String(qualifying || offersNew), lbl: "éligibles" };
  return null;
}

function AutoApplyValidateCallout({ count }: { count: number }) {
  return (
    <div className="db-auto-validate db-auto-validate--lite" role="status" aria-live="polite">
      <p className="db-auto-validate__text">
        {count > 1
          ? `${count} onglets ouverts avec les formulaires pré-remplis.`
          : "Un onglet est ouvert avec le formulaire pré-rempli."}{" "}
        Vérifiez puis cliquez « Envoyer la candidature ».
      </p>
    </div>
  );
}

const SCAN_PHASES = ["boot", "scrape_prepare", "scrape_query", "scrape_desc", "scrape_done"];
const SCORE_PHASES = ["analyze", "hunt_fill"];
const GEN_PHASES = ["generate", "sync", "done"];

const STAGES = [
  { id: "scan", label: "Scan" },
  { id: "score", label: "Scoring" },
  { id: "gen", label: "Génération" },
] as const;

function PipelineStages({ subPhase }: { subPhase: string }) {
  const inScan = SCAN_PHASES.includes(subPhase);
  const inScore = SCORE_PHASES.includes(subPhase);
  const inGen = GEN_PHASES.includes(subPhase);
  const isHuntFill = subPhase === "hunt_fill";

  const states: Record<(typeof STAGES)[number]["id"], string> = {
    scan: inScan ? "is-active" : "is-done",
    score: inScore ? "is-active" : inGen ? "is-done" : "",
    gen: inGen ? "is-active" : "",
  };

  const fillWidth = inGen ? "100%" : inScore ? "50%" : inScan ? "16%" : "0%";

  return (
    <div className="db-pipeline-steps" aria-hidden="true">
      <div className="db-pipeline-steps__rail">
        <span className="db-pipeline-steps__fill" style={{ width: fillWidth }} />
      </div>
      <ol className="db-pipeline-steps__list">
        {STAGES.map((stage) => (
          <li key={stage.id} className={`db-pipeline-steps__item ${states[stage.id]}`}>
            <span className="db-pipeline-steps__dot" />
            <span className="db-pipeline-steps__label">
              {stage.label}
              {stage.id === "score" && isHuntFill && (
                <span className="db-pipeline-steps__loop" title="Scan complémentaire">
                  ↻
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function PipelineProgress({
  run,
  jobsFound = 0,
  targetRoles: _targetRoles,
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
      ? "Auto-postulation"
      : analyzeOnly
        ? "Analyse"
        : "Recherche";

  const stopLabel = autoapply
    ? "Stopper l'auto-postulation"
    : analyzeOnly
      ? "Stopper l'analyse"
      : "Stopper";

  const metaLine = [
    `${primary.val} ${primary.lbl}`,
    secondary ? `${secondary.val} ${secondary.lbl}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const stepLine = `Étape ${phase.step || 1}/${steps.length} · ${phase.stepLabel}`;

  if (compact) {
    return (
      <section className="db-pipeline-live db-pipeline-live--compact" aria-live="polite">
        {phase.subPhase === "autoapply_ready" && (
          <AutoApplyValidateCallout count={phase.autoapplyTotal || phase.autoapplyReady || 1} />
        )}
        <div className="db-pipeline-live__head">
          <div className="db-pipeline-live__head-main">
            <p className="db-pipeline-live__meta">
              {eyebrow} · {stepLine} · {phase.progress}%
            </p>
            <p className="db-pipeline-live__title">{phase.detail}</p>
          </div>
          {onStop && (
            <button
              type="button"
              className="db-pipeline-live__stop"
              disabled={stopping}
              onClick={onStop}
            >
              {stopping ? "Arrêt…" : stopLabel}
            </button>
          )}
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
      <div className="db-pipeline-live__head">
        <div className="db-pipeline-live__head-main">
          <p className="db-pipeline-live__meta">
            {eyebrow} · {stepLine} · {phase.progress}%
          </p>
          <h3 className="db-pipeline-live__title">{phase.detail}</h3>
          {phase.subdetail ? (
            <p className="db-pipeline-live__sub">{phase.subdetail}</p>
          ) : null}
        </div>
        {onStop && (
          <button
            type="button"
            className="db-pipeline-live__stop"
            disabled={stopping}
            onClick={onStop}
          >
            {stopping ? "Arrêt…" : stopLabel}
          </button>
        )}
      </div>

      {!autoapply && !analyzeOnly && (
        <PipelineStages subPhase={phase.subPhase} />
      )}

      <div className="db-pipeline-live__bar" aria-hidden="true">
        <span style={{ width: `${phase.progress}%` }} />
      </div>

      <p className="db-pipeline-live__nums">{metaLine}</p>
    </section>
  );
}
