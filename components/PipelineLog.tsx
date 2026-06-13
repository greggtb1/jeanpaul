"use client";

import { useEffect, useRef, useMemo, useState } from "react";

export type PipelineRun = {
  id: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  log: string;
  created_at?: string | null;
  finished_at?: string | null;
  result?: {
    mode?: string;
    new_urls?: string[];
    generated_urls?: string[];
  } | null;
};

const IDLE_LINES = [
  { text: "[sys]  jean-paul-engine v2.4.0 · idle", cls: "plog__line--head" },
  { text: "[net]  linkedin scraper .......... standby", cls: "plog__line--cmd" },
  { text: "[api]  jean paul .................. ready", cls: "plog__line--cmd" },
  { text: "[db]   supabase sync ............ ok", cls: "plog__line--cmd" },
  { text: "[que]  awaiting pipeline trigger…", cls: "plog__line--analyze" },
];

const BOOT_LINES = [
  { text: "[boot] JEAN PAUL kernel v2.4.0", cls: "plog__line--head" },
  { text: "[init] allocation mémoire ........ OK", cls: "plog__line--cmd" },
  { text: "[sync] supabase ................ OK", cls: "plog__line--cmd" },
  { text: "[sync] jean paul .............. OK", cls: "plog__line--cmd" },
  { text: "[sync] linkedin scraper ........ OK", cls: "plog__line--cmd" },
  { text: "[eng]  moteur prêt · en attente de mission", cls: "plog__line--analyze" },
];

function lineClass(line: string): string {
  const t = line.toLowerCase();
  if (line.startsWith("✅") || line.includes("Terminé") || line.includes("nouvelles offres"))
    return "plog__line plog__line--ok";
  if (line.startsWith("⚠️") || line.includes("ALERTE FIT"))
    return "plog__line plog__line--warn";
  if (line.startsWith("❌") || t.includes("échoué") || t.includes("error"))
    return "plog__line plog__line--err";
  if (line.startsWith("🚀") || line.startsWith("──"))
    return "plog__line plog__line--head";
  if (line.includes("WTTJ") || line.includes("LinkedIn") || line.startsWith("🔍"))
    return "plog__line plog__line--scrape";
  if (line.includes("/10") || line.includes("Analyse"))
    return "plog__line plog__line--analyze";
  if (line.startsWith("$") || line.startsWith("["))
    return "plog__line plog__line--cmd";
  return "plog__line";
}

function BootSequence({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    if (step >= BOOT_LINES.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 120 : 380);
    return () => clearTimeout(t);
  }, [active, step]);

  if (!active) return null;

  return (
    <div className="plog__boot" aria-hidden="true">
      {BOOT_LINES.slice(0, step).map((line, i) => (
        <div key={line.text} className={`plog__line ${line.cls} plog__boot-line`} style={{ animationDelay: `${i * 40}ms` }}>
          {line.text}
        </div>
      ))}
      {step < BOOT_LINES.length && (
        <div className="plog__boot-bar">
          <span style={{ width: `${Math.min(100, (step / BOOT_LINES.length) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function PipelineLog({
  run,
}: {
  run: PipelineRun | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => (run?.log ? run.log.split("\n").filter(Boolean) : []), [run?.log]);

  const idle = !run;
  const running = run?.status === "running" || run?.status === "pending";
  const done = run?.status === "done";
  const failed = run?.status === "failed";
  const cancelled = run?.status === "cancelled";
  const [bootDone, setBootDone] = useState(false);

  useEffect(() => {
    if (!running || lines.length > 0) {
      setBootDone(false);
      return;
    }
    const t = setTimeout(() => setBootDone(true), 2800);
    return () => clearTimeout(t);
  }, [running, lines.length, run?.id]);

  const showBoot = running && lines.length === 0 && !bootDone;
  const showWaiting = running && lines.length === 0 && bootDone;
  const showIdle = idle && !running;

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, run?.log, showBoot, showIdle]);

  return (
    <div className={`plog ${idle ? "plog--idle" : ""}`}>
      <div className="plog__header">
        <div className="plog__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="plog__title">JEAN PAUL · terminal</span>
        <span className={`plog__badge ${idle ? "plog__badge--idle" : running ? "plog__badge--run" : done ? "plog__badge--ok" : cancelled ? "plog__badge--idle" : failed ? "plog__badge--err" : ""}`}>
          {(idle || running) && <span className={`plog__pulse ${idle ? "plog__pulse--idle" : ""}`} />}
          {idle ? "Standby" : running ? "En cours" : done ? "Terminé" : cancelled ? "Arrêté" : failed ? "Erreur" : run!.status}
        </span>
      </div>

      <div className="plog__progress" aria-hidden="true">
        <span style={{ width: `${run?.progress || (running ? 8 : 0)}%` }} />
      </div>

      <div
        ref={bodyRef}
        className={`plog__body ${showBoot ? "plog__body--booting" : ""} ${showIdle ? "plog__body--idle" : ""}`}
      >
        <div className="plog__grid" aria-hidden="true" />
        <div className="plog__scanline" aria-hidden="true" />

        {showIdle ? (
          <div className="plog__idle">
            {IDLE_LINES.map((line) => (
              <div key={line.text} className={`plog__line ${line.cls}`}>
                {line.text}
              </div>
            ))}
            <div className="plog__cursor plog__cursor--idle" aria-hidden="true" />
          </div>
        ) : showBoot ? (
          <BootSequence active />
        ) : showWaiting ? (
          <p className="plog__line plog__line--muted">En attente du moteur Python…</p>
        ) : lines.length === 0 ? (
          <p className="plog__line plog__line--muted">En attente du moteur Python…</p>
        ) : (
          lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 24)}`} className={lineClass(line)}>
              {line}
            </div>
          ))
        )}
        {running && !showBoot && <div className="plog__cursor" aria-hidden="true" />}
      </div>
    </div>
  );
}
