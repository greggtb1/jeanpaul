"use client";

import { useMemo } from "react";
import type { PipelineRun } from "@/components/PipelineLog";
import { parsePipelinePhase } from "@/lib/pipeline-phase";

const SCAN_PHASES = ["boot", "scrape_prepare", "scrape_query", "scrape_desc", "scrape_done"];
const SCORE_PHASES = ["analyze", "hunt_fill"];
const GEN_PHASES = ["generate", "sync", "done"];

function getHero(
  phase: ReturnType<typeof parsePipelinePhase>,
  hideOfferQuota = false
): { value: string; label: string } {
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
    const hideDenom =
      hideOfferQuota &&
      (phase.subPhase === "hunt_fill" || phase.subPhase === "analyze");
    return { value: hideDenom ? frac[1] : `${frac[1]}/${frac[2]}`, label };
  }

  if (phase.subPhase === "scrape_done" && phase.offersNew) {
    return { value: String(phase.offersNew), label: "nouvelles offres" };
  }
  if (SCAN_PHASES.includes(phase.subPhase) && phase.queriesTotal) {
    return { value: `${phase.queriesDone}/${phase.queriesTotal}`, label: "requêtes" };
  }
  if (GEN_PHASES.includes(phase.subPhase)) {
    return { value: String(phase.generated || 0), label: "dossiers prêts" };
  }
  if (phase.subPhase === "boot") {
    return { value: "…", label: "démarrage" };
  }

  return { value: "…", label: phase.stepLabel.toLowerCase() };
}

function getStatusLabel(
  phase: ReturnType<typeof parsePipelinePhase>,
  autoapply: boolean,
  analyzeOnly: boolean,
  importOnly: boolean
): string {
  if (phase.subPhase === "autoapply_ready") return "À valider dans le navigateur";
  if (autoapply) return "Auto-postulation";
  if (importOnly) return "Import d'offre";
  if (analyzeOnly) return "Analyse des offres";
  if (SCORE_PHASES.includes(phase.subPhase)) return "Recherche & notation";
  if (GEN_PHASES.includes(phase.subPhase)) return "Rédaction du CV et de la lettre";
  if (SCAN_PHASES.includes(phase.subPhase)) return "Scan LinkedIn + HelloWork";
  if (phase.subPhase === "done") return "Terminé";
  return "En cours";
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
  launching = false,
  launchMode,
  trialDiscovery = false,
}: {
  run: PipelineRun | null;
  jobsFound?: number;
  targetRoles?: string[] | null;
  compact?: boolean;
  onStop?: () => void;
  stopping?: boolean;
  launching?: boolean;
  launchMode?: "full" | "analyze" | "import" | "autoapply" | "unlock" | null;
  /** Mode découverte : n'affiche pas le plafond (/8) sur les offres retenues. */
  trialDiscovery?: boolean;
}) {
  const phase = useMemo(() => parsePipelinePhase(run, jobsFound), [run, jobsFound]);
  const hero = launching
    ? { value: "…", label: launchMode === "unlock" ? "déblocage" : "démarrage" }
    : getHero(phase, trialDiscovery);

  const autoapply = run?.result?.mode === "autoapply" || /auto.?apply|auto.?postul/i.test(run?.log || "");
  const analyzeOnly = /Reprise\s*:\s*analyse|sans scraping/i.test(run?.log || "");
  const importOnly =
    launchMode === "import" ||
    run?.result?.mode === "import" ||
    /Import d'une offre|Import d'offre/i.test(run?.log || "");
  const statusLabel = launching
    ? launchMode === "import"
      ? "Import d'offre"
      : launchMode === "analyze"
        ? "Analyse des offres"
        : launchMode === "unlock"
          ? "Déblocage des dossiers"
          : "Démarrage"
    : getStatusLabel(phase, autoapply, analyzeOnly, importOnly);
  const showInlineLoader =
    launching || !["done", "autoapply_ready"].includes(phase.subPhase);
  const progressPct = launching ? 4 : phase.progress;
  const showEta = showInlineLoader && !autoapply;

  const stopButton = onStop && !launching ? (
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
          <div className="db-run__bar" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        {showEta && <p className="db-run__eta">environ 1 min pour un scan complet</p>}
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
        <div className="db-run__bar" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progressPct}%` }} />
        </div>
      </div>
      {showEta && <p className="db-run__eta">environ 1 min pour un scan complet</p>}
    </section>
  );
}
