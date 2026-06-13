"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { type Profile, type Job } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { getPlan } from "@/lib/plans";
import {
  buildUpgradeOffer,
  buyCreditsPath,
  countGeneratedJobs,
  countWeeklyGeneratedJobs,
  getQuotaUsage,
  pipelineQuotaBlockReason,
  upgradeSubscribePath,
  type UpgradeOffer,
} from "@/lib/plan-quota";
import PipelineLog, { type PipelineRun } from "@/components/PipelineLog";
import PipelineProgress from "@/components/PipelineProgress";
import { parsePipelinePhase, isAutoapplyRun } from "@/lib/pipeline-phase";
import LetterModal from "@/components/LetterModal";
import AutoApplyTuto from "@/components/AutoApplyTuto";
import FirstSearchDoneTuto, { hasSeenFirstSearchDoneTuto } from "@/components/FirstSearchDoneTuto";
import DashboardGuide from "@/components/DashboardGuide";
import NoCvCalibrationModal from "@/components/NoCvCalibrationModal";
import { needsPreScanNoCvModal, calibrationPromptLabel } from "@/lib/no-cv-calibration";
import { loadDraft } from "@/lib/onboarding-draft";
import { buildOnboardingPrefsPatch } from "@/lib/sync-onboarding-prefs";
import { parseApiJson } from "@/lib/parse-api-json";
import { isJobReady, isJobReadyWithoutCv } from "@/lib/job-ready";

type TabId = "all" | "applied" | "generated";

function StatFilterChips({
  stats,
  tab,
  onChange,
}: {
  stats: { total: number; ready: number; applied: number };
  tab: TabId;
  onChange: (id: TabId) => void;
}) {
  const toggle = (id: TabId) => onChange(tab === id ? "all" : id);

  return (
    <div className="db__stats-inline" role="group" aria-label="Filtrer les offres">
      <button
        type="button"
        className={`db__stat-chip db__stat-chip--btn${tab === "all" ? " is-active" : ""}`}
        onClick={() => toggle("all")}
        aria-pressed={tab === "all"}
      >
        {stats.total} offres
      </button>
      {stats.ready > 0 && (
        <button
          type="button"
          className={`db__stat-chip db__stat-chip--btn db__stat-chip--coral${tab === "generated" ? " is-active" : ""}`}
          onClick={() => toggle("generated")}
          aria-pressed={tab === "generated"}
        >
          {stats.ready} dossier{stats.ready > 1 ? "s" : ""} prêt{stats.ready > 1 ? "s" : ""}
        </button>
      )}
      {stats.applied > 0 && (
        <button
          type="button"
          className={`db__stat-chip db__stat-chip--btn db__stat-chip--green${tab === "applied" ? " is-active" : ""}`}
          onClick={() => toggle("applied")}
          aria-pressed={tab === "applied"}
        >
          {stats.applied} candidaté{stats.applied > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

function getJobScore(job: Job): number | null {
  const s = job.fit_score ?? (job.data?._fit_score as number | undefined);
  return typeof s === "number" ? s : null;
}

function getJobFitReasoning(job: Job): string | null {
  const d = job.data || {};
  const analysis = d._analysis as Record<string, unknown> | undefined;
  const fromAnalysis =
    typeof analysis?.fit_reasoning === "string" ? analysis.fit_reasoning.trim() : "";
  if (fromAnalysis) return fromAnalysis;
  const direct = typeof d.fit_reasoning === "string" ? d.fit_reasoning.trim() : "";
  return direct || null;
}

/** Dégradé bleu 1→10 ; saut marqué entre 5 (pâle) et 6 (seuil qualifiant). */
function getScoreDialStyle(score: number): React.CSSProperties {
  const s = Math.max(1, Math.min(10, Math.round(score)));

  const blueScale = [
    // 1-5 : bleus très pâles (mauvais fit)
    { from: "#f4f7ff", to: "#dce6f8", border: "#c5d4eb", text: "#64748b", shadow: "#b8c8e0" },
    { from: "#eef3ff", to: "#cddcf5", border: "#b0c4e8", text: "#475569", shadow: "#a0b8dc" },
    { from: "#e5edff", to: "#b8ccf0", border: "#9ab5e0", text: "#334155", shadow: "#8aa8d4" },
    { from: "#d8e6ff", to: "#9eb8eb", border: "#7a9ed8", text: "#1e3a6a", shadow: "#6b90cc" },
    { from: "#c8dcff", to: "#85a8e8", border: "#5580d8", text: "#1e3a6a", shadow: "#4a70c8" },
    // 6 : bleu moyen — seuil qualifiant
    { from: "#7aa8f8", to: "#4d80f0", border: "#3366e0", text: "#fff",    shadow: "#2550c8" },
    // 7 : bleu soutenu
    { from: "#4d7ef5", to: "#2255e8", border: "#1844d0", text: "#fff",    shadow: "#1238b0" },
    // 8 : bleu vif
    { from: "#2f5ce8", to: "#0a3dd4", border: "#0030b8", text: "#fff",    shadow: "#00279a" },
    // 9 : bleu intense
    { from: "#0f42d8", to: "#0028b0", border: "#001e90", text: "#fff",    shadow: "#001575" },
    // 10 : bleu profond presque indigo
    { from: "#0028a8", to: "#001878", border: "#001260", text: "#fff",    shadow: "#000d48" },
  ];

  const blue = blueScale[s - 1];

  return {
    background: `linear-gradient(145deg, ${blue.from} 0%, ${blue.to} 100%)`,
    borderColor: blue.border,
    color: blue.text,
    boxShadow: `1px 1px 0 0 ${blue.shadow}`,
  };
}

function isAutoApplyEligible(job: Job): boolean {
  if (job.applied || !job.cv_url || !job.letter_url) return false;
  const s = getJobScore(job);
  return s != null && s >= 6;
}

function isPriorityJob(job: Job): boolean {
  if (job.cv_url || job.letter_url || job.applied) return true;
  if (isJobReadyWithoutCv(job)) return true;
  const s = getJobScore(job);
  if (s === null) return true;
  return s >= 6;
}

function sortByScore(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const sa = getJobScore(a);
    const sb = getJobScore(b);
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa;
  });
}

function getFitTier(score: number | null): "10" | "9" | "8" | null {
  if (score == null) return null;
  const s = Math.round(score);
  if (s >= 10) return "10";
  if (s >= 9) return "9";
  if (s >= 8) return "8";
  return null;
}

function splitJobs(jobs: Job[]) {
  const priority = sortByScore(jobs.filter(isPriorityJob));
  const low = sortByScore(jobs.filter((j) => !isPriorityJob(j)));
  return { priority, low };
}

function mergeJobsPreservingOrder(prev: Job[], incoming: Job[]): Job[] {
  if (!prev.length) return incoming;
  const byUrl = new Map(incoming.map((j) => [j.url, j]));
  const merged: Job[] = [];
  const seen = new Set<string>();

  for (const j of prev) {
    const updated = byUrl.get(j.url);
    if (updated) {
      merged.push(updated);
      seen.add(j.url);
    }
  }

  const fresh = incoming.filter((j) => !seen.has(j.url));
  return [...fresh, ...merged];
}

function restoreScrollY(y: number) {
  const html = document.documentElement;
  const prevBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollTo(0, y);
  requestAnimationFrame(() => {
    window.scrollTo(0, y);
    html.style.scrollBehavior = prevBehavior;
  });
}

type FitHealth = {
  analyzed: number;
  avg: number;
  qualifying: number;
  max: number;
};

function computeFitHealth(jobs: Job[]): FitHealth | null {
  const scored = jobs.map(getJobScore).filter((s): s is number => s != null);
  if (!scored.length) return null;
  const avg = Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10;
  return {
    analyzed: scored.length,
    avg,
    qualifying: scored.filter((s) => s >= 6).length,
    max: Math.max(...scored),
  };
}

/** Décalage profil / mots-clés : assez d'offres analysées, fits très bas. */
function isPoorFitHealth(health: FitHealth): boolean {
  if (health.analyzed < 12) return false;
  if (health.qualifying === 0) return true;
  if (health.avg <= 3.5) return true;
  if (health.analyzed >= 20 && health.qualifying / health.analyzed <= 0.03) return true;
  return false;
}

export default function Dashboard() {
  const router = useRouter();
  const { uid, loading: authLoading } = useAuth();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<TabId>("all");
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [lastSearch, setLastSearch] = useState<PipelineRun | null>(null);
  const [launching, setLaunching] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [showAutoTuto, setShowAutoTuto] = useState(false);
  const [showFirstDoneTuto, setShowFirstDoneTuto] = useState(false);
  const [showNoCvCalib, setShowNoCvCalib] = useState(false);
  const [sideTab, setSideTab] = useState<"terminal" | "guide">("terminal");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevRunStatusRef = useRef<string | null>(null);
  const pendingLaunchRef = useRef<{ mode: "full" | "analyze"; urls?: string[] } | null>(null);

  const freshUrls = useMemo(() => {
    const urls = lastSearch?.result?.new_urls;
    if (urls?.length) return new Set(urls);
    if (!lastSearch?.created_at) return new Set<string>();
    const cutoff = new Date(lastSearch.created_at).getTime();
    return new Set(
      jobs
        .filter((j) => j.created_at && new Date(j.created_at).getTime() >= cutoff)
        .map((j) => j.url)
    );
  }, [lastSearch, jobs]);

  const isFresh = useCallback((job: Job) => freshUrls.has(job.url), [freshUrls]);

  const load = useCallback(async (id: string, silent = false, resort = false) => {
    if (!silent) setLoading(true);
    const scrollY = silent && !resort ? window.scrollY : null;
    const [{ data: profRaw }, { data: js }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("jobs")
        .select("url,data,fit_score,applied,deleted,cv_url,letter_url,user_id,created_at,updated_at")
        .eq("user_id", id)
        .eq("deleted", false)
        .order("created_at", { ascending: false }),
    ]);
    let prof = profRaw;
    const prefsPatch = buildOnboardingPrefsPatch(prof, loadDraft());
    if (prefsPatch) {
      const { data: synced } = await supabase
        .from("profiles")
        .update({ ...prefsPatch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (synced) prof = synced;
      else if (prof) prof = { ...prof, ...prefsPatch };
    }
    const { data: runs } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("user_id", id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(10);
    const lastSearchRun = (runs || []).find(
      (r) => r.result?.mode === "full" || !r.result?.mode
    ) as PipelineRun | undefined;
    setLastSearch(lastSearchRun ?? null);
    setProfile(prof);
    const incoming = (js as Job[]) || [];
    setJobs((prev) =>
      silent && !resort ? mergeJobsPreservingOrder(prev, incoming) : incoming
    );
    if (scrollY != null) {
      requestAnimationFrame(() => restoreScrollY(scrollY));
    }
    if (!silent) setLoading(false);
    return prof;
  }, []);

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline", { credentials: "same-origin" });
      const data = await parseApiJson<{ run?: PipelineRun; error?: string }>(res);
      if (!res.ok) {
        console.warn("[pipeline]", data.error || res.status);
        if (res.status >= 500) return null;
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      setRun(data.run ?? null);
      return data.run ?? null;
    } catch (e) {
      console.warn("[pipeline] fetch failed", e);
      return null;
    }
  }, []);

  const startPipeline = useCallback(async (
    mode: "full" | "autoapply" | "analyze" = "full",
    urls?: string[]
  ) => {
    setLaunching(true);
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ...(urls?.length ? { urls } : {}),
        }),
      });
      const data = await parseApiJson<{
        error?: string;
        alreadyRunning?: boolean;
        quotaExceeded?: boolean;
      }>(res);
      if (!res.ok || data.error) {
        if (data.quotaExceeded) {
          router.push(upgradeSubscribePath());
          return;
        }
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      if (mode === "autoapply") {
        setSelectMode(false);
        setSelectedUrls(new Set());
        setShowAutoTuto(false);
      }
      if (mode === "full" && !data.alreadyRunning) {
        setProfile((p) => (p ? { ...p, first_search_done: true } : p));
      }
      await fetchRun();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }, [fetchRun, router, uid, supabase]);

  const onboardingDraft = useMemo(() => loadDraft(), [profile?.id]);

  const requestPipelineLaunch = useCallback(
    (mode: "full" | "analyze" = "full", urls?: string[]) => {
      if (needsPreScanNoCvModal(profile)) {
        pendingLaunchRef.current = { mode, urls };
        setShowNoCvCalib(true);
        return;
      }
      void startPipeline(mode, urls);
    },
    [profile, onboardingDraft, startPipeline]
  );

  const handleCalibrationComplete = useCallback(
    (updated: Profile) => {
      const pending = pendingLaunchRef.current;
      pendingLaunchRef.current = null;
      setProfile(updated);
      setShowNoCvCalib(false);
      window.dispatchEvent(new CustomEvent("ja:prefs-updated"));
      if (pending) void startPipeline(pending.mode, pending.urls);
    },
    [startPipeline]
  );

  const stopPipeline = useCallback(async () => {
    if (!run?.id) return;
    setStopping(true);
    const prevRun = run;
    setRun({
      ...run,
      status: "cancelled",
      log: `${run.log || ""}${run.log?.includes("Arrêt demandé") ? "" : "\n⛔ Arrêt demandé. Interruption en cours…\n"}`,
      finished_at: new Date().toISOString(),
    });
    try {
      const q = new URLSearchParams({ runId: run.id });
      const res = await fetch(`/api/pipeline?${q}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await parseApiJson<{ error?: string; stopped?: boolean }>(res);
      if (!res.ok) throw new Error(data.error || `Impossible d'arrêter (${res.status})`);
      await fetchRun();
      if (uid) await load(uid, true);
    } catch (e) {
      setRun(prevRun);
      alert((e as Error).message);
    } finally {
      setStopping(false);
    }
  }, [fetchRun, load, run, uid]);

  useEffect(() => {
    if (!uid) return;
    load(uid);
    fetchRun();
    const onPrefs = () => load(uid, true);
    window.addEventListener("ja:prefs-updated", onPrefs);
    return () => window.removeEventListener("ja:prefs-updated", onPrefs);
  }, [uid, load, fetchRun]);

  // Poll logs tant que le pipeline tourne
  useEffect(() => {
    if (!uid) return;
    const active = run?.status === "running" || run?.status === "pending";
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const latest = await fetchRun();
      if (latest?.status === "running" || latest?.status === "pending") {
        load(uid, true);
      }
      if (latest && (latest.status === "done" || latest.status === "failed" || latest.status === "cancelled")) {
        load(uid, true, latest.status === "done");
      }
    }, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [uid, run?.status, fetchRun, load]);

  useEffect(() => {
    if (!run?.status) return;
    const prev = prevRunStatusRef.current;
    const wasRunning = prev === "running" || prev === "pending";
    const mode = run.result?.mode;
    const isFirstSearchRun = mode !== "autoapply" && mode !== "analyze";

    if (wasRunning && run.status === "done" && isFirstSearchRun && !hasSeenFirstSearchDoneTuto()) {
      setShowFirstDoneTuto(true);
    }
    prevRunStatusRef.current = run.status;
  }, [run?.status, run?.result?.mode]);

  const toggleApplied = useCallback(async (url: string) => {
    if (!uid) return;
    let nextApplied = false;
    let found = false;
    setJobs((prev) => {
      const job = prev.find((j) => j.url === url);
      if (!job) return prev;
      found = true;
      nextApplied = !job.applied;
      return prev.map((j) => (j.url === url ? { ...j, applied: nextApplied } : j));
    });
    if (!found) return;
    const { error } = await supabase
      .from("jobs")
      .update({ applied: nextApplied })
      .eq("url", url)
      .eq("user_id", uid);
    if (error) {
      setJobs((prev) =>
        prev.map((j) => (j.url === url ? { ...j, applied: !nextApplied } : j))
      );
      alert(
        nextApplied
          ? "Impossible de marquer le dossier comme candidaté."
          : "Impossible de décocher le dossier candidaté."
      );
    }
  }, [uid, supabase]);

  const filtered = useMemo(() => {
    const list = jobs.filter((j) => {
      if (tab === "generated") return isJobReady(j);
      if (tab === "applied") return !!j.applied;
      return true;
    });
    return sortByScore(list);
  }, [jobs, tab]);

  const autoApplyEligible = useMemo(() => jobs.filter(isAutoApplyEligible), [jobs]);

  const enterSelectMode = useCallback(() => {
    setTab("generated");
    setSelectMode(true);
    setSelectedUrls(new Set(autoApplyEligible.map((j) => j.url)));
  }, [autoApplyEligible]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedUrls(new Set());
  }, []);

  const toggleSelectUrl = useCallback((url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const launchAutoApply = useCallback(() => {
    if (!uid || selectedUrls.size === 0) return;
    startPipeline("autoapply", Array.from(selectedUrls));
  }, [uid, selectedUrls, startPipeline]);

  const firstName = profile?.full_name?.split(" ")[0] || "vous";
  const pipelineActive = run?.status === "running" || run?.status === "pending";

  const stats = useMemo(() => {
    const scored = jobs.map(getJobScore).filter((s): s is number => s != null);
    const avg = scored.length
      ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
      : 0;
    return {
      total: jobs.length,
      ready: jobs.filter(isJobReady).length,
      applied: jobs.filter((j) => j.applied).length,
      avg,
    };
  }, [jobs]);

  const fitScopeJobs = useMemo(() => {
    if (freshUrls.size >= 8 || pipelineActive) {
      return jobs.filter((j) => freshUrls.has(j.url));
    }
    return jobs;
  }, [jobs, freshUrls, pipelineActive]);

  const fitHealth = useMemo(() => computeFitHealth(fitScopeJobs), [fitScopeJobs]);
  const showPoorFitAlert = !!fitHealth && isPoorFitHealth(fitHealth);

  const plan = useMemo(() => getPlan(profile?.plan_id), [profile?.plan_id]);
  const generatedCount = useMemo(() => countGeneratedJobs(jobs), [jobs]);
  const weeklyGeneratedCount = useMemo(() => countWeeklyGeneratedJobs(jobs), [jobs]);
  const quotaOpts = useMemo(
    () => ({
      generatedCount,
      weeklyGeneratedCount,
      firstSearchDone: !!profile?.first_search_done,
      bonusCredits: profile?.bonus_credits ?? 0,
    }),
    [generatedCount, weeklyGeneratedCount, profile?.first_search_done, profile?.bonus_credits]
  );
  const quotaUsage = useMemo(() => getQuotaUsage(plan, quotaOpts), [plan, quotaOpts]);
  const scanBlockReason = useMemo(
    () => pipelineQuotaBlockReason(plan, "full", quotaOpts),
    [plan, quotaOpts]
  );
  const scanUpgrade = useMemo(
    () => buildUpgradeOffer(plan.id, scanBlockReason),
    [plan.id, scanBlockReason]
  );
  const analyzeBlockReason = useMemo(
    () => pipelineQuotaBlockReason(plan, "analyze", quotaOpts),
    [plan, quotaOpts]
  );
  const analyzeUpgrade = useMemo(
    () => buildUpgradeOffer(plan.id, analyzeBlockReason),
    [plan.id, analyzeBlockReason]
  );
  const generationBlocked = !!scanBlockReason || !!analyzeBlockReason;

  const showFirstSearch =
    !loading &&
    !authLoading &&
    !profile?.first_search_done &&
    jobs.length === 0 &&
    !pipelineActive;

  const pendingAnalysis = useMemo(
    () => jobs.filter((j) => getJobScore(j) == null).length,
    [jobs]
  );

  return (
    <>
      <main className="db__main db__main--with-terminal">
        <div className="db__hello">
          <h1>Bonjour {firstName}</h1>
          {!showFirstSearch && (
            <p className="db__hello-sub">
              {profile?.target_roles?.length
                ? profile.target_roles.join(" · ")
                : "Configurez votre recherche pour démarrer."}
              {!loading && (
                <span
                  className={`db__quota-chip${quotaUsage.exhausted ? " db__quota-chip--full" : ""}`}
                  title={
                    quotaUsage.weeklyLimit
                      ? `Plafond hebdo : ${quotaUsage.weeklyLimit} dossiers`
                      : undefined
                  }
                >
                  {quotaUsage.used}/{quotaUsage.limit} {quotaUsage.label.toLowerCase()}
                  {quotaUsage.bonusCredits > 0 && ` · +${quotaUsage.bonusCredits} bonus`}
                </span>
              )}
            </p>
          )}
        </div>

        <div className={`db-page-split${showFirstSearch ? " db-page-split--first" : ""}`}>
          <div className="db-page-main">
        {showFirstSearch && (
          <section className="db-first" aria-labelledby="first-search-title">
            <h2 id="first-search-title" className="db-first__title">
              Votre premier scan
            </h2>
            <p className="db-first__lead">
              LinkedIn est parcouru selon votre profil. Jusqu&apos;à 15 bons matchs reçoivent une note, un CV et une lettre prêts à soumettre.
            </p>
            <div className="db-first__flow" aria-hidden="true">
              <ol className="db-first__flow-steps">
                <li className="db-first__flow-step is-active">Scan</li>
                <li className="db-first__flow-step">Note /10</li>
                <li className="db-first__flow-step">CV + lettre</li>
              </ol>
              <div className="db-first__flow-rail">
                <span />
              </div>
            </div>
            <div className="db-first__foot">
              <button
                type="button"
                className="btn btn--accent db-first__cta"
                disabled={launching}
                onClick={() => uid && requestPipelineLaunch()}
              >
                {launching ? "Lancement…" : "Lancer la recherche"}
              </button>
              <p className="db-first__hint">
                {needsPreScanNoCvModal(profile)
                  ? calibrationPromptLabel(profile, onboardingDraft) ||
                    "Déposez votre CV pour personnaliser vos dossiers à chaque offre."
                  : "Suivez l\u2019avancement dans le terminal."}
              </p>
            </div>
          </section>
        )}

        {!showFirstSearch && (
          <>
        {showPoorFitAlert && fitHealth && (
          <PoorFitAlert health={fitHealth} roles={profile?.target_roles} />
        )}

        {pipelineActive ? (
          <PipelineProgress
            run={run}
            jobsFound={jobs.length}
            targetRoles={profile?.target_roles}
            onStop={stopPipeline}
            stopping={stopping}
          />
        ) : (
          <>
            {pendingAnalysis > 0 && !analyzeBlockReason && (
              <AnalyzePendingCta
                count={pendingAnalysis}
                launching={launching}
                onAnalyze={() => requestPipelineLaunch("analyze")}
              />
            )}
            {pendingAnalysis > 0 && analyzeBlockReason && (
              <QuotaBlockedNotice
                title={`${pendingAnalysis} offre${pendingAnalysis > 1 ? "s" : ""} en attente`}
                reason={analyzeBlockReason}
                upgrade={analyzeUpgrade}
              />
            )}
            {generationBlocked && !scanBlockReason && analyzeBlockReason && !pendingAnalysis && (
              <QuotaBlockedNotice
                title="Quota de dossiers atteint"
                reason={analyzeBlockReason}
                upgrade={analyzeUpgrade}
              />
            )}
            <DashboardActionsBar
              launching={launching}
              onSearch={() => requestPipelineLaunch()}
              scanDisabled={!!scanBlockReason}
              scanDisabledReason={scanBlockReason}
              scanUpgrade={scanUpgrade}
              applyCount={autoApplyEligible.length}
              totalJobs={jobs.length}
              selectMode={selectMode}
              selectedCount={selectedUrls.size}
              onStartApply={enterSelectMode}
              onCancelApply={exitSelectMode}
              onSelectAll={() => setSelectedUrls(new Set(autoApplyEligible.map((j) => j.url)))}
              onDeselectAll={() => setSelectedUrls(new Set())}
              onLaunchApply={() => setShowAutoTuto(true)}
            />
          </>
        )}

        <div className={`db__jobs-head${selectMode ? " db__jobs-head--selecting" : ""}`}>
          <div className="db__jobs-head-left">
            <h2 className="db__jobs-title">
              {selectMode ? "Offres éligibles" : "Vos offres"}
            </h2>
            {!selectMode && (
              <StatFilterChips stats={stats} tab={tab} onChange={setTab} />
            )}
          </div>
        </div>

        {loading || authLoading ? (
          <div className="db__empty">Chargement…</div>
        ) : pipelineActive && filtered.length === 0 ? (
          <ScanJobsWaiting />
        ) : filtered.length === 0 ? (
          <div className="db__empty">
            <div className="db__empty-emoji">🛰️</div>
            <h3>Aucune offre pour l&apos;instant</h3>
            <p>Lancez une nouvelle recherche ci-dessus pour scanner LinkedIn selon vos critères.</p>
          </div>
        ) : (
          <JobList
            jobs={filtered}
            isFresh={isFresh}
            onToggleApplied={toggleApplied}
            pipelineActive={pipelineActive}
            profile={profile}
            selectMode={selectMode}
            selectedUrls={selectedUrls}
            onToggleSelect={toggleSelectUrl}
          />
        )}

          </>
        )}
          </div>

          <aside
            className={`db-page-terminal${sideTab === "guide" ? " db-page-terminal--guide" : ""}`}
            aria-label="Panneau latéral"
          >
            <div className="db-side-tabs">
              <button
                className={`db-side-tab${sideTab === "terminal" ? " db-side-tab--active" : ""}`}
                onClick={() => setSideTab("terminal")}
              >Terminal</button>
              <button
                className={`db-side-tab${sideTab === "guide" ? " db-side-tab--active" : ""}`}
                onClick={() => setSideTab("guide")}
              >Comment ça marche</button>
            </div>
            {sideTab === "terminal" ? (
              <PipelineLog run={run} />
            ) : (
              <DashboardGuide />
            )}
          </aside>
        </div>
      </main>
      {showAutoTuto && (
        <AutoApplyTuto
          launching={launching}
          onClose={() => setShowAutoTuto(false)}
          onLaunch={launchAutoApply}
        />
      )}
      {showFirstDoneTuto && (
        <FirstSearchDoneTuto onClose={() => setShowFirstDoneTuto(false)} />
      )}
      {showNoCvCalib && uid && (
        <NoCvCalibrationModal
          profile={profile}
          userId={uid}
          saving={launching}
          onClose={() => {
            pendingLaunchRef.current = null;
            setShowNoCvCalib(false);
          }}
          onComplete={handleCalibrationComplete}
        />
      )}
    </>
  );
}

function Stat({ value, label, accent }: { value: number | string; label: string; accent?: string }) {
  return (
    <div className="db__stat">
      <div className={`db__stat-value ${accent ? `db__stat-value--${accent}` : ""}`}>{value}</div>
      <div className="db__stat-label">{label}</div>
    </div>
  );
}

function DashboardActionsBar({
  launching,
  onSearch,
  scanDisabled,
  scanDisabledReason,
  scanUpgrade,
  applyCount,
  totalJobs = 0,
  selectMode,
  selectedCount = 0,
  onStartApply,
  onCancelApply,
  onSelectAll,
  onDeselectAll,
  onLaunchApply,
}: {
  launching: boolean;
  onSearch: () => void;
  scanDisabled?: boolean;
  scanDisabledReason?: string | null;
  scanUpgrade?: UpgradeOffer | null;
  applyCount?: number;
  totalJobs?: number;
  selectMode?: boolean;
  selectedCount?: number;
  onStartApply?: () => void;
  onCancelApply?: () => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onLaunchApply?: () => void;
}) {
  const total = applyCount ?? 0;
  const allSelected = total > 0 && selectedCount === total;
  const canApply = total > 0;

  // Message expliquant pourquoi l'auto-apply n'est pas disponible
  const applyBlockReason = !canApply
    ? totalJobs === 0
      ? "Lancez d'abord une recherche pour obtenir des offres."
      : "Aucune offre avec CV + lettre générés (score ≥ 6). Lancez une recherche."
    : null;

  return (
    <div className="db-acts-wrap">
      <div className="db-acts-btns">
        {scanDisabled && scanUpgrade && !scanUpgrade.isMaxPlan ? (
          <Link
            href={scanUpgrade.href}
            className="db-big-btn db-big-btn--upgrade"
            aria-label={`Obtenir plus de dossiers, passer au plan ${scanUpgrade.name}`}
          >
            Plus de dossiers
          </Link>
        ) : (
          <button
            type="button"
            className="db-big-btn"
            disabled={launching || selectMode || scanDisabled}
            onClick={onSearch}
            title={scanDisabledReason ?? undefined}
          >
            {launching ? "Lancement…" : "Scanner"}
          </button>
        )}

        <div className={`db-big-btn-group${selectMode ? " db-big-btn-group--active" : ""}`}>
          <button
            type="button"
            className="db-big-btn db-big-btn--apply"
            disabled={selectMode || !canApply}
            onClick={canApply ? onStartApply : undefined}
            title={applyBlockReason ?? undefined}
          >
            Postuler
            <span className="db-big-btn__beta">(beta)</span>
            {canApply ? ` (${total})` : ""}
          </button>
          {selectMode && onCancelApply && (
            <button
              type="button"
              className="db-big-btn-stop"
              onClick={onCancelApply}
              aria-label="Annuler la sélection"
              title="Annuler"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {!canApply && applyBlockReason && !selectMode && (
        <p className="db-acts-apply-hint">{applyBlockReason}</p>
      )}

      {scanDisabled && scanDisabledReason && (!scanUpgrade || scanUpgrade.isMaxPlan) && !selectMode && (
        <p className="db-acts-apply-hint">
          {scanDisabledReason}{" "}
          <Link href={buyCreditsPath()} className="db-acts-upgrade-link">
            Acheter des dossiers
          </Link>
        </p>
      )}

      {selectMode && total > 0 && (
        <div className="db-acts-select" role="toolbar" aria-label="Sélection des offres">
          <span className="db-acts-select__count">
            {selectedCount} sur {total} sélectionnée{selectedCount > 1 ? "s" : ""}
          </span>
          <div className="db-acts-select__actions">
            <button
              type="button"
              className="db-acts-select__toggle"
              onClick={allSelected ? onDeselectAll : onSelectAll}
            >
              {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
            <button
              type="button"
              className="db-big-btn db-acts-select__launch"
              disabled={selectedCount === 0}
              onClick={onLaunchApply}
            >
              Envoyer sur LinkedIn
            </button>
          </div>
        </div>
      )}

      {!selectMode && (
        <a href="/dashboard/preferences" className="db-acts-config">
          Modifier les critères de recherche
        </a>
      )}
    </div>
  );
}

function ReadyToApplyCta({ count, onStart }: { count: number; onStart: () => void }) {
  return null;
}


function AnalyzePendingCta({
  count,
  launching,
  onAnalyze,
}: {
  count: number;
  launching: boolean;
  onAnalyze: () => void;
}) {
  return (
    <section className="db-analyze-pending" aria-labelledby="db-analyze-pending-title">
      <div className="db-analyze-pending__icon" aria-hidden="true">
        📋
      </div>
      <div className="db-analyze-pending__body">
        <p className="db-analyze-pending__eyebrow">Offres en attente</p>
        <h2 id="db-analyze-pending-title" className="db-analyze-pending__title">
          {count} offre{count > 1 ? "s" : ""} à analyser
        </h2>
        <p className="db-analyze-pending__text">
          Reprenez là où vous vous êtes arrêté : scoring et dossiers prêts à soumettre, sans relancer LinkedIn.
        </p>
      </div>
      <div className="db-analyze-pending__actions">
        <button
          type="button"
          className="btn btn--navy"
          disabled={launching}
          onClick={onAnalyze}
        >
          {launching ? "Lancement…" : "Analyser les offres"}
        </button>
      </div>
    </section>
  );
}

function QuotaBlockedNotice({
  title,
  reason,
  upgrade,
}: {
  title: string;
  reason: string;
  upgrade: UpgradeOffer | null;
}) {
  return (
    <section className="db-quota-blocked" role="status">
      <div className="db-quota-blocked__body">
        <p className="db-quota-blocked__eyebrow">Quota atteint</p>
        <h2 className="db-quota-blocked__title">{title}</h2>
        <p className="db-quota-blocked__text">{reason}</p>
      </div>
      <div className="db-quota-blocked__actions">
        {upgrade && !upgrade.isMaxPlan && (
          <Link href={upgrade.href} className="btn btn--outline btn--sm db-quota-blocked__cta">
            Passer à {upgrade.name}
            {upgrade.priceHint ? ` · ${upgrade.priceHint}` : ""}
          </Link>
        )}
        <Link href={buyCreditsPath()} className="db-quota-blocked__credits">
          Acheter des dossiers
        </Link>
        {upgrade?.isMaxPlan && (
          <p className="db-quota-blocked__wait">Quota renouvelé chaque semaine.</p>
        )}
      </div>
    </section>
  );
}


function PoorFitAlert({
  health,
  roles,
}: {
  health: FitHealth;
  roles?: string[] | null;
}) {
  const rolesLabel = roles?.length ? roles.join(", ") : "vos mots-clés";
  return (
    <div className="db__fit-alert" role="alert">
      <div className="db__fit-alert-icon" aria-hidden="true">
        ⚠️
      </div>
      <div className="db__fit-alert-body">
        <p className="db__fit-alert-title">Décalage profil / recherche détecté</p>
        <p className="db__fit-alert-text">
          {health.analyzed} offres analysées · score moyen{" "}
          <strong>{health.avg}/10</strong>
          {health.qualifying === 0
            ? " · aucune offre ≥6/10"
            : ` · seulement ${health.qualifying} offre${health.qualifying > 1 ? "s" : ""} ≥6/10`}
          . Votre CV ne semble pas correspondre aux postes recherchés ({rolesLabel}).
        </p>
        <div className="db__fit-alert-actions">
          <a href="/dashboard/preferences" className="db__fit-alert-link">
            Ajuster mes critères
          </a>
        </div>
      </div>
    </div>
  );
}

function useEnteringJobs(jobs: Job[]) {
  const knownRef = useRef<Set<string>>(new Set());
  const initRef = useRef(false);
  const [entering, setEntering] = useState<Set<string>>(new Set());

  useEffect(() => {
    const urls = jobs.map((j) => j.url);
    if (!initRef.current) {
      initRef.current = true;
      knownRef.current = new Set(urls);
      return;
    }
    const fresh = urls.filter((u) => !knownRef.current.has(u));
    knownRef.current = new Set(urls);
    if (!fresh.length) return;

    setEntering((prev) => new Set([...prev, ...fresh]));
    const maxDelay = 500 + fresh.length * 70;
    const t = setTimeout(() => {
      setEntering((prev) => {
        const next = new Set(prev);
        fresh.forEach((u) => next.delete(u));
        return next;
      });
    }, maxDelay);
    return () => clearTimeout(t);
  }, [jobs]);

  return entering;
}

function ScanJobsWaiting() {
  return (
    <div className="db__scan-waiting" role="status" aria-live="polite">
      <span className="db__scan-waiting-spinner" aria-hidden="true" />
      <p>Recherche d&apos;offres en cours…</p>
    </div>
  );
}

function JobList({
  jobs,
  isFresh,
  onToggleApplied,
  pipelineActive,
  profile,
  selectMode,
  selectedUrls,
  onToggleSelect,
}: {
  jobs: Job[];
  isFresh: (j: Job) => boolean;
  onToggleApplied: (url: string) => void;
  pipelineActive?: boolean;
  profile: Profile | null;
  selectMode?: boolean;
  selectedUrls?: Set<string>;
  onToggleSelect?: (url: string) => void;
}) {
  const entering = useEnteringJobs(jobs);
  const sorted = useMemo(() => sortByScore(jobs), [jobs]);

  const rowSelectProps = (j: Job) => ({
    selectMode,
    selectable: isAutoApplyEligible(j),
    selected: selectedUrls?.has(j.url) ?? false,
    onToggleSelect: onToggleSelect ? () => onToggleSelect(j.url) : undefined,
  });

  if (pipelineActive) {
    return (
      <div className="db__list db__list--live">
        {sorted.map((j, i) => (
          <JobRow
            key={j.url}
            job={j}
            fresh={isFresh(j)}
            entering={entering.has(j.url)}
            enterDelay={i * 65}
            analyzing={getJobScore(j) == null}
            onToggleApplied={() => onToggleApplied(j.url)}
            profile={profile}
            {...rowSelectProps(j)}
          />
        ))}
      </div>
    );
  }

  const { priority, low } = splitJobs(sorted);

  return (
    <>
      <div className="db__list">
        {priority.map((j, i) => (
          <JobRow
            key={j.url}
            job={j}
            fresh={isFresh(j)}
            entering={entering.has(j.url)}
            enterDelay={i * 65}
            onToggleApplied={() => onToggleApplied(j.url)}
            profile={profile}
            {...rowSelectProps(j)}
          />
        ))}
      </div>
      {low.length > 0 && (
        <LowJobsFold
          jobs={low}
          isFresh={isFresh}
          entering={entering}
          onToggleApplied={onToggleApplied}
          profile={profile}
          selectMode={selectMode}
          selectedUrls={selectedUrls}
          onToggleSelect={onToggleSelect}
        />
      )}
    </>
  );
}

function LowJobsFold({
  jobs,
  isFresh,
  onToggleApplied,
  entering,
  profile,
  selectMode,
  selectedUrls,
  onToggleSelect,
}: {
  jobs: Job[];
  isFresh: (j: Job) => boolean;
  onToggleApplied: (url: string) => void;
  entering?: Set<string>;
  profile: Profile | null;
  selectMode?: boolean;
  selectedUrls?: Set<string>;
  onToggleSelect?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="db__low-fold">
      <button type="button" className="db__low-toggle" onClick={() => setOpen((v) => !v)}>
        <span>
          Peu pertinentes : {jobs.length} offre{jobs.length > 1 ? "s" : ""} &lt; 6/10
        </span>
        <span className="db__low-chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="db__list db__list--low">
          {jobs.map((j, i) => (
            <JobRow
              key={j.url}
              job={j}
              fresh={isFresh(j)}
              compact
              entering={entering?.has(j.url)}
              enterDelay={i * 50}
              onToggleApplied={() => onToggleApplied(j.url)}
              profile={profile}
              selectMode={selectMode}
              selectable={isAutoApplyEligible(j)}
              selected={selectedUrls?.has(j.url) ?? false}
              onToggleSelect={onToggleSelect ? () => onToggleSelect(j.url) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  fresh,
  compact,
  entering,
  enterDelay = 0,
  analyzing,
  onToggleApplied,
  profile,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
}: {
  job: Job;
  fresh?: boolean;
  compact?: boolean;
  entering?: boolean;
  enterDelay?: number;
  analyzing?: boolean;
  onToggleApplied?: () => void;
  profile: Profile | null;
  selectMode?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const d = job.data || {};
  const title = (d.title as string) || "Offre";
  const company = (d.company as string) || "";
  const location = (d.location as string) || "";
  const url = (d.url as string) || job.url;
  const score = getJobScore(job);
  const fitTier = getFitTier(score);
  const fitReasoning = getJobFitReasoning(job);
  const canExpandDetail = !!fitReasoning && !analyzing;
  const docsUnavailable = isJobReadyWithoutCv(job) && !job.cv_url;

  const [letterOpen, setLetterOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  useEffect(() => {
    if (job.applied) return;
    setJustSent(false);
  }, [job.applied]);

  const handleToggleApplied = () => {
    if (!onToggleApplied) return;
    if (!job.applied) setJustSent(true);
    else setJustSent(false);
    onToggleApplied();
  };

  return (
    <article
      className={[
        "jr",
        "",
        compact ? "jr--low" : "jr--seen",
        entering ? "jr--enter" : "",
        analyzing ? "jr--analyzing" : "",
        canExpandDetail ? "jr--expandable" : "",
        detailOpen ? "jr--open" : "",
        job.applied ? "jr--sent" : "",
        justSent ? "jr--just-sent" : "",
        selectMode && selectable ? "jr--selectable" : "",
        selectMode && selected ? "jr--selected" : "",
        fitTier ? `jr--fit-${fitTier}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={entering ? { animationDelay: `${enterDelay}ms` } : undefined}
    >
      {selectMode && (
        <label
          className={[
            "jr__select",
            selectable ? "" : "jr__select--disabled",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={(e) => e.stopPropagation()}
          title={selectable ? (selected ? "Retirer de la sélection" : "Ajouter à la sélection") : "Offre non éligible"}
        >
          <input
            type="checkbox"
            disabled={!selectable}
            checked={!!selected}
            onChange={() => onToggleSelect?.()}
            aria-label={selectable ? `Sélectionner ${title}` : "Offre non éligible"}
          />
        </label>
      )}
      {canExpandDetail ? (
        <div
          className="jr__click"
          role="button"
          tabIndex={0}
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen((open) => !open)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setDetailOpen((open) => !open);
            }
          }}
        >
          <div
            className={[
              "jr__dial",
              score == null ? "is-na" : "",
              compact ? "jr__dial--sm" : "",
              analyzing ? "jr__dial--loading" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={score != null && !analyzing ? getScoreDialStyle(score) : undefined}
            aria-label={
              analyzing
                ? "Analyse en cours"
                : score != null
                  ? `Score ${score} sur 10`
                  : "Non analysée"
            }
          >
            {analyzing ? (
              <>
                <span className="jr__dial-spin" aria-hidden="true" />
                <span className="jr__dial-loading-label">…</span>
              </>
            ) : (
              <>
                <span className="jr__dial-num">{score != null ? score : "?"}</span>
                <span className="jr__dial-max">/10</span>
              </>
            )}
          </div>
          <div className="jr__main">
            <div className="jr__head">
              <h3 className="jr__title">{title}</h3>
              {fresh && !compact && !job.applied && (
                <span className="jr__pill jr__pill--new">new</span>
              )}
              {fitTier === "10" && !analyzing && !compact && (
                <span className="jr__pill jr__pill--fit-perfect">Match parfait</span>
              )}
              {fitTier === "9" && !analyzing && !compact && (
                <span className="jr__pill jr__pill--fit-top">Top match</span>
              )}
              {fitTier === "8" && !analyzing && !compact && (
                <span className="jr__pill jr__pill--fit-great">Excellent fit</span>
              )}
              {analyzing && (
                <span className="jr__pill jr__pill--analyzing">
                  <span className="jr__pill-dot" aria-hidden="true" />
                  Analyse
                </span>
              )}
            </div>
            <p className="jr__meta">
              {company}
              {location ? ` · ${location}` : ""}
            </p>
          </div>
          <span className="jr__chev" aria-hidden="true">
            ▾
          </span>
        </div>
      ) : (
        <>
      <div
        className={[
          "jr__dial",
          score == null ? "is-na" : "",
          compact ? "jr__dial--sm" : "",
          analyzing ? "jr__dial--loading" : "",
          job.applied ? "jr__dial--sent" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={score != null && !analyzing ? getScoreDialStyle(score) : undefined}
        aria-label={
          analyzing
            ? "Analyse en cours"
            : score != null
              ? `Score ${score} sur 10`
              : "Non analysée"
        }
      >
        {analyzing ? (
          <>
            <span className="jr__dial-spin" aria-hidden="true" />
            <span className="jr__dial-loading-label">…</span>
          </>
        ) : (
          <>
            <span className="jr__dial-num">{score != null ? score : "?"}</span>
            <span className="jr__dial-max">/10</span>
          </>
        )}
      </div>
      <div className="jr__main">
        <div className="jr__head">
          <h3 className="jr__title">{title}</h3>
          {fresh && !compact && !job.applied && (
            <span className="jr__pill jr__pill--new">new</span>
          )}
          {fitTier === "10" && !analyzing && !compact && (
            <span className="jr__pill jr__pill--fit-perfect">Match parfait</span>
          )}
          {fitTier === "9" && !analyzing && !compact && (
            <span className="jr__pill jr__pill--fit-top">Top match</span>
          )}
          {fitTier === "8" && !analyzing && !compact && (
            <span className="jr__pill jr__pill--fit-great">Excellent fit</span>
          )}
          {analyzing && (
            <span className="jr__pill jr__pill--analyzing">
              <span className="jr__pill-dot" aria-hidden="true" />
              Analyse
            </span>
          )}
        </div>
        <p className="jr__meta">
          {company}
          {location ? ` · ${location}` : ""}
        </p>
      </div>
        </>
      )}
      <div className="jr__actions" onClick={(e) => canExpandDetail && e.stopPropagation()}>
        {!compact && docsUnavailable && (
          <>
            <span
              className="jr__doc jr__doc--cv jr__doc--disabled"
              title="Scan lancé sans CV : ajoutez un CV à votre profil pour générer ce document"
            >
              CV
            </span>
            <span
              className="jr__doc jr__doc--letter jr__doc--disabled"
              title="Scan lancé sans CV : ajoutez un CV à votre profil pour générer ce document"
            >
              Lettre
            </span>
          </>
        )}
        {!compact && job.cv_url && (
          <button
            type="button"
            className="jr__doc jr__doc--cv"
            onClick={async () => {
              try {
                const res = await fetch(`/api/storage/signed-url?url=${encodeURIComponent(job.cv_url!)}`);
                const data = await res.json();
                if (data.url) window.open(data.url, "_blank", "noopener");
                else alert("Impossible d'ouvrir le CV. Relancez une recherche pour le régénérer.");
              } catch { alert("Erreur réseau."); }
            }}
          >
            CV
          </button>
        )}
        {!compact && job.letter_url && (
          <button
            type="button"
            className="jr__doc jr__doc--letter"
            onClick={() => setLetterOpen(true)}
            title="Lettre de motivation"
          >
            Lettre
          </button>
        )}
        {url && (
          <a className="jr__link" href={url} target="_blank" rel="noopener">
            {compact ? "Voir" : "voir l'offre"}
          </a>
        )}
        {!compact && isJobReady(job) && onToggleApplied && (
          <button
            type="button"
            className={`jr__mark ${job.applied ? "jr__mark--done" : ""}`}
            onClick={handleToggleApplied}
            title={job.applied ? "Marquer comme non candidaté" : "Marquer comme candidaté"}
            aria-pressed={!!job.applied}
          >
            ✓
          </button>
        )}
      </div>
      {canExpandDetail && detailOpen && (
        <div className={`jr__detail${compact ? "" : " jr__detail--full"}`}>
          <p className="jr__detail-text">{fitReasoning}</p>
        </div>
      )}
      {letterOpen && job.letter_url && (
        <LetterModal
          company={company}
          title={title}
          letterUrl={job.letter_url}
          profile={profile}
          onClose={() => setLetterOpen(false)}
        />
      )}
    </article>
  );
}
