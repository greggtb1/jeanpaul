"use client";

import { useMemo } from "react";
import type { PipelineRun } from "@/components/PipelineLog";
import { parsePipelinePhase } from "@/lib/pipeline-phase";

const SCAN_PHASES = ["boot", "scrape_prepare", "scrape_query", "scrape_desc", "scrape_done"];
const SCORE_PHASES = ["analyze", "hunt_fill"];
const GEN_PHASES = ["generate", "sync", "done"];

const FULL_STAGES = [
  { id: "scan", label: "LinkedIn" },
  { id: "score", label: "Note /10" },
  { id: "gen", label: "CV + lettre" },
] as const;

const ANALYZE_STAGES = [
  { id: "score", label: "Note /10" },
  { id: "gen", label: "CV + lettre" },
] as const;

const AUTO_STAGES = [
  { id: "prep", label: "Préparation" },
  { id: "fill", label: "Formulaires" },
  { id: "send", label: "Validation" },
] as const;

function getHero(phase: ReturnType<typeof parsePipelinePhase>): { value: string; label: string } {
  const frac = phase.detail.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) {
    const label =
      phase.subPhase === "generate" || phase.subPhase === "sync"
        ? "dossiers prêts"
        : phase.subPhase === "hunt_fill" || phase.subPhase === "analyze"
          ? "offres retenues"
          : phase.subPhase.startsWith("autoapply")
            ? "formulaires"
            : "progression";
    return { value: `${frac[1]}/${frac[2]}`, label };
  }

  if (phase.subPhase === "scrape_done" && phase.offersNew) {
    return { value: String(phase.offersNew), label: "nouvelles offres" };
  }
  if (SCAN_PHASES.includes(phase.subPhase) && phase.queriesTotal) {
    return { value: `${phase.queriesDone}/${phase.queriesTotal}`, label: "requêtes" };
  }
  if (phase.subPhase === "boot") {
    return { value: "…", label: "démarrage" };
  }

  return { value: "…", label: phase.stepLabel.toLowerCase() };
}

function getStatusLabel(
  phase: ReturnType<typeof parsePipelinePhase>,
  autoapply: boolean,
  analyzeOnly: boolean
): string {
  if (phase.subPhase === "autoapply_ready") return "À valider dans le navigateur";
  if (autoapply) return "Auto-postulation";
  if (analyzeOnly) return "Analyse des offres";
  if (SCORE_PHASES.includes(phase.subPhase)) return "Recherche & notation";
  if (GEN_PHASES.includes(phase.subPhase)) return "Rédaction CV + lettre";
  if (SCAN_PHASES.includes(phase.subPhase)) return "Scan LinkedIn";
  if (phase.subPhase === "done") return "Terminé";
  return "En cours";
}

function StageTrack({
  stages,
  activeId,
}: {
  stages: readonly { id: string; label: string }[];
  activeId: string;
}) {
  const activeIdx = stages.findIndex((s) => s.id === activeId);

  return (
    <ol className="db-run__steps" data-cols={stages.length} aria-label="Étapes">
      {stages.map((stage, i) => {
        const state =
          i < activeIdx ? "is-done" : i === activeIdx ? "is-active" : "is-upcoming";
        return (
          <li key={stage.id} className={`db-run__step ${state}`}>
            <span className="db-run__step-dot" aria-hidden="true" />
            <span className="db-run__step-label">{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function resolveStages(
  phase: ReturnType<typeof parsePipelinePhase>,
  autoapply: boolean,
  analyzeOnly: boolean
) {
  if (autoapply) {
    let active = "prep";
    if (phase.subPhase === "autoapply_fill") active = "fill";
    if (phase.subPhase === "autoapply_ready" || phase.subPhase === "done") active = "send";
    return { stages: AUTO_STAGES, activeId: active };
  }
  if (analyzeOnly) {
    const active = GEN_PHASES.includes(phase.subPhase) ? "gen" : "score";
    return { stages: ANALYZE_STAGES, activeId: active };
  }

  const inScore = SCORE_PHASES.includes(phase.subPhase);
  const inGen = GEN_PHASES.includes(phase.subPhase);
  const active = inGen ? "gen" : inScore ? "score" : "scan";
  return { stages: FULL_STAGES, activeId: active };
}

function InlineLoader({ label }: { label: string }) {
  return (
    <span className="db-run__inline-loader" aria-label={`${label} en cours`}>
      <span className="db-run__inline-loader-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="db-run__inline-loader-text">en cours</span>
    </span>
  );
}

function AutoApplyValidateCallout({ count }: { count: number }) {
  return (
    <div className="db-auto-validate db-auto-validate--lite" role="status" aria-live="polite">
      <p className="db-auto-validate__text">
        {count > 1
          ? `${count} onglets ouverts, cliquez « Envoyer la candidature » sur chacun.`
          : "Onglet ouvert, cliquez « Envoyer la candidature »."}
      </p>
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
  const hero = getHero(phase);

  const autoapply = run?.result?.mode === "autoapply" || /auto.?apply|auto.?postul/i.test(run?.log || "");
  const analyzeOnly = /Reprise\s*:\s*analyse|sans scraping/i.test(run?.log || "");
  const statusLabel = getStatusLabel(phase, autoapply, analyzeOnly);
  const stageTrack = resolveStages(phase, autoapply, analyzeOnly);
  const showInlineLoader = !["done", "autoapply_ready"].includes(phase.subPhase);

  const stopButton = onStop ? (
    <button
      type="button"
      className="db-run__stop"
      disabled={stopping}
      onClick={onStop}
    >
      {stopping ? "…" : "Stop"}
    </button>
  ) : null;

  if (compact) {
    return (
      <section className="db-run db-run--compact" aria-live="polite">
        <div className="db-run__head">
          <span className="db-run__pulse" aria-hidden="true" />
          <span className="db-run__status">{statusLabel}</span>
          {showInlineLoader && <InlineLoader label={statusLabel} />}
          {stopButton}
        </div>
        <div className="db-run__metric">
          <span className="db-run__value">{hero.value}</span>
          <span className="db-run__unit">{hero.label}</span>
        </div>
        <div className="db-run__progress">
          <div className="db-run__bar" role="progressbar" aria-valuenow={phase.progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${phase.progress}%` }} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="db-run" aria-live="polite">
      {phase.subPhase === "autoapply_ready" && (
        <AutoApplyValidateCallout count={phase.autoapplyTotal || phase.autoapplyReady || 1} />
      )}

      <div className="db-run__head">
        <span className="db-run__pulse" aria-hidden="true" />
        <span className="db-run__status">{statusLabel}</span>
        {showInlineLoader && <InlineLoader label={statusLabel} />}
        {stopButton}
      </div>

      <div className="db-run__metric">
        <span className="db-run__value">{hero.value}</span>
        <span className="db-run__unit">{hero.label}</span>
      </div>

      <div className="db-run__progress">
        <div className="db-run__bar" role="progressbar" aria-valuenow={phase.progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${phase.progress}%` }} />
        </div>
        <StageTrack
          stages={stageTrack.stages}
          activeId={stageTrack.activeId}
        />
      </div>
    </section>
  );
}
