"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef, useMemo, type FormEvent } from "react";
import { type Profile, type Job } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { getPlan, parsePlanId } from "@/lib/plans";
import TrialUsedBlock from "@/components/TrialUsedBlock";
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
import CvModal from "@/components/CvModal";
import AutoApplyTuto from "@/components/AutoApplyTuto";
import AgentLaunchBanner from "@/components/AgentLaunchBanner";
import { openAgentDeepLink } from "@/lib/agent-client";
import DashboardProductTour, {
  shouldOfferDashboardProductTour,
  clearForcedDashboardProductTour,
} from "@/components/DashboardProductTour";
import DashboardGuide from "@/components/DashboardGuide";
import NoCvCalibrationModal from "@/components/NoCvCalibrationModal";

function useMobileLayout(maxWidth = 900) {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [maxWidth]);

  return mobile;
}
import { needsPreScanNoCvModal, calibrationPromptLabel, hasUploadedCv } from "@/lib/no-cv-calibration";
import { loadDraft } from "@/lib/onboarding-draft";
import { resolveProfileCv } from "@/lib/onboarding-cv";
import { buildOnboardingPrefsPatch } from "@/lib/sync-onboarding-prefs";
import { parseApiJson } from "@/lib/parse-api-json";
import { canToggleAppliedMark, isJobReady, isJobReadyWithoutCv, MIN_READY_SCORE } from "@/lib/job-ready";
import { isTrialDecoyJob } from "@/lib/trial-decoy";
import { isPlausiblePersonName } from "@/lib/file-name";
import { isTrialDiscoveryComplete, shouldShowTrialPaywall } from "@/lib/trial-discovery";
import { trackEvent } from "@/lib/umami";

type TabId = "all" | "applied" | "generated";
type PipelineStartMode = "full" | "autoapply" | "analyze" | "import" | "unlock";

/** Compteur qui s'incrémente en douceur quand la valeur change. */
function AnimatedCount({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const [bump, setBump] = useState(false);
  const fromRef = useRef(value);
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    fromRef.current = to;

    let raf = 0;
    let bumpTimer: ReturnType<typeof setTimeout> | undefined;
    if (to > from) {
      setBump(true);
      bumpTimer = setTimeout(() => setBump(false), 360);
    }

    const duration = 520;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      if (bumpTimer) clearTimeout(bumpTimer);
    };
  }, [value]);

  return (
    <span className={`db__stat-count${bump ? " is-bump" : ""}`}>{display}</span>
  );
}

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
    <div className="db__stats-inline" role="group" aria-label="Filtrer les offres" data-tour="stats-chips">
      <button
        type="button"
        className={`db__stat-chip db__stat-chip--btn${tab === "all" ? " is-active" : ""}`}
        onClick={() => toggle("all")}
        aria-pressed={tab === "all"}
      >
        <AnimatedCount value={stats.total} />
        <span className="db__stat-label-text">offres</span>
      </button>
      {stats.ready > 0 && (
        <button
          type="button"
          className={`db__stat-chip db__stat-chip--btn db__stat-chip--coral${tab === "generated" ? " is-active" : ""}`}
          onClick={() => toggle("generated")}
          aria-pressed={tab === "generated"}
        >
          <AnimatedCount value={stats.ready} />
          <span className="db__stat-label-text">dossier{stats.ready > 1 ? "s" : ""} prêt{stats.ready > 1 ? "s" : ""}</span>
        </button>
      )}
      {stats.applied > 0 && (
        <button
          type="button"
          className={`db__stat-chip db__stat-chip--btn db__stat-chip--green${tab === "applied" ? " is-active" : ""}`}
          onClick={() => toggle("applied")}
          aria-pressed={tab === "applied"}
        >
          <AnimatedCount value={stats.applied} />
          <span className="db__stat-label-text">candidaté{stats.applied > 1 ? "s" : ""}</span>
        </button>
      )}
    </div>
  );
}

function getJobScore(job: Job): number | null {
  if (isImportedJob(job)) return null;
  const s = job.fit_score ?? (job.data?._fit_score as number | undefined);
  return typeof s === "number" ? s : null;
}

function isImportedJob(job: Job): boolean {
  return !!(job.data as Record<string, unknown> | undefined)?.imported_manually;
}

function getJobFitReasoning(job: Job): string | null {
  if (isImportedJob(job)) return null;
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
  };
}

function isAutoApplyEligible(job: Job): boolean {
  if (isTrialDecoyJob(job)) return false;
  if (job.applied || !job.cv_url || !job.letter_url) return false;
  if (isImportedJob(job)) return true;
  const s = getJobScore(job);
  return s != null && s >= 6;
}

function isPriorityJob(job: Job): boolean {
  if (job.cv_url || job.letter_url || job.applied) return true;
  if (isImportedJob(job)) return true;
  if (isJobReadyWithoutCv(job)) return true;
  const s = getJobScore(job);
  if (s === null) return true;
  return s >= 6;
}

/**
 * Rang d'affichage : dossiers générés (CV/lettre prêts) d'abord, puis vraies
 * offres sans documents, enfin les offres factices (floutées) en dernier.
 */
function jobDisplayRank(job: Job): number {
  if (isTrialDecoyJob(job)) return 2;
  if (job.cv_url || job.letter_url) return 0;
  return 1;
}

function sortByScore(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const da = isTrialDecoyJob(a) ? 1 : 0;
    const db = isTrialDecoyJob(b) ? 1 : 0;
    if (da !== db) return da - db;
    const sa = getJobScore(a);
    const sb = getJobScore(b);
    if (sa != null && sb != null && sa !== sb) return sb - sa;
    if (sa == null && sb != null) return 1;
    if (sb == null && sa != null) return -1;
    const ra = jobDisplayRank(a);
    const rb = jobDisplayRank(b);
    return ra - rb;
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
  const { uid, user, loading: authLoading } = useAuth();
  const isMobile = useMobileLayout();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<TabId>("all");
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [lastSearch, setLastSearch] = useState<PipelineRun | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchMode, setLaunchMode] = useState<PipelineStartMode | null>(null);
  const [stopping, setStopping] = useState(false);
  const [showAutoTuto, setShowAutoTuto] = useState(false);
  const [agentDeepLink, setAgentDeepLink] = useState<string | null>(null);
  const [agentAwaiting, setAgentAwaiting] = useState(false);
  const [showProductTour, setShowProductTour] = useState(false);
  const [showNoCvCalib, setShowNoCvCalib] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [hidePoorFitAlert, setHidePoorFitAlert] = useState(false);
  const [sideTab, setSideTab] = useState<"terminal" | "guide">("terminal");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [paywallContext, setPaywallContext] = useState<PaywallContext | null>(null);
  const [trialUsedBlock, setTrialUsedBlock] = useState(false);
  const [noCompatibleNotice, setNoCompatibleNotice] = useState(false);
  const finalizeDocsPendingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlockTriggeredRef = useRef(false);
  const prevRunStatusRef = useRef<string | null>(null);
  const productTourAutoOpenedRef = useRef(false);
  const productTourEligiblePendingRef = useRef(false);
  const pendingTourActionRef = useRef<(() => void) | null>(null);
  const pendingLaunchRef = useRef<{
    mode: Exclude<PipelineStartMode, "autoapply">;
    urls?: string[];
    importUrl?: string;
  } | null>(null);

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
    if (prof && !hasUploadedCv(prof)) {
      try {
        const cv = await resolveProfileCv(id, {
          cvUrl: prof.cv_url,
          cvFilename: prof.cv_filename,
        });
        if (cv) {
          const { data: cvSynced } = await supabase
            .from("profiles")
            .update({
              cv_url: cv.url,
              cv_filename: cv.filename,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id)
            .select("*")
            .maybeSingle();
          if (cvSynced) prof = cvSynced;
        }
      } catch {
        /* La modale CV prendra le relais si l'import local échoue. */
      }
    }
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
    const isTrialProfile = prof?.subscription_status === "trial";
    const incoming = ((js as Job[]) || []).filter(
      (j) => !isTrialDecoyJob(j) || isTrialProfile
    );
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
    mode: PipelineStartMode = "full",
    urls?: string[],
    importUrl?: string
  ) => {
    setLaunching(true);
    setLaunchMode(mode);
    if (!isMobile) setSideTab("terminal");
    trackEvent("pipeline_start_clicked", {
      mode,
      selected_urls: urls?.length ?? 0,
      first_search_done: !!profile?.first_search_done,
      has_cv: hasUploadedCv(profile),
      plan: profile?.plan_id ?? null,
    });
    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ...(urls?.length ? { urls } : {}),
          ...(importUrl ? { import_url: importUrl } : {}),
        }),
      });
      const data = await parseApiJson<{
        error?: string;
        alreadyRunning?: boolean;
        quotaExceeded?: boolean;
        executor?: string;
        deepLink?: string;
      }>(res);
      if (!res.ok || data.error) {
        if (data.quotaExceeded) {
          trackEvent("pipeline_quota_exceeded", { mode, plan: profile?.plan_id ?? null });
          router.push(upgradeSubscribePath());
          return;
        }
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      trackEvent("pipeline_started", {
        mode,
        already_running: !!data.alreadyRunning,
        first_search_done: !!profile?.first_search_done,
      });
      if (mode === "autoapply") {
        setShowAutoTuto(false);
        if (data.executor === "desktop" && data.deepLink) {
          setAgentDeepLink(data.deepLink);
          setAgentAwaiting(true);
          openAgentDeepLink(data.deepLink);
        }
      }
      if (mode === "full" && !data.alreadyRunning) {
        setProfile((p) => (p ? { ...p, first_search_done: true } : p));
      }
      await fetchRun();
    } catch (e) {
      trackEvent("pipeline_start_error", { mode });
      setLaunchMode(null);
      alert((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }, [fetchRun, router, profile?.first_search_done, profile?.cv_url, profile?.plan_id, isMobile]);

  const retryAgentDeepLink = useCallback(() => {
    if (agentDeepLink) openAgentDeepLink(agentDeepLink);
  }, [agentDeepLink]);

  useEffect(() => {
    if (
      run?.status === "done" ||
      run?.status === "failed" ||
      run?.status === "cancelled"
    ) {
      setLaunchMode(null);
    }
  }, [run?.status, run?.id]);

  useEffect(() => {
    if (!agentAwaiting || !run) return;
    const log = run.log || "";
    const agentConnected =
      run.status === "running" ||
      log.includes("[agent]") ||
      log.includes("Auto-apply") ||
      log.includes("Chromium");
    if (agentConnected) {
      setAgentAwaiting(false);
      return;
    }
    const t = window.setTimeout(() => {
      if (run.status === "pending" && !log.trim()) {
        setAgentAwaiting(true);
      }
    }, 30_000);
    return () => window.clearTimeout(t);
  }, [agentAwaiting, run?.status, run?.log, run]);

  useEffect(() => {
    if (run?.status === "done" || run?.status === "failed" || run?.status === "cancelled") {
      setAgentDeepLink(null);
      setAgentAwaiting(false);
    }
  }, [run?.status]);

  const onboardingDraft = useMemo(() => loadDraft(), [profile?.id]);

  const requestPipelineLaunch = useCallback(
    (
      mode: Exclude<PipelineStartMode, "autoapply"> = "full",
      urls?: string[],
      importUrl?: string
    ) => {
      const unlockBusy =
        launchMode === "unlock" &&
        (launching || run?.status === "running" || run?.status === "pending");
      if (unlockBusy) {
        alert(
          "Patientez : génération des CV et lettres des offres débloquées en cours."
        );
        return;
      }
      if (mode !== "import" && !hasUploadedCv(profile)) {
        pendingLaunchRef.current = { mode, urls, importUrl };
        setShowNoCvCalib(true);
        return;
      }
      void startPipeline(mode, urls, importUrl);
    },
    [profile, onboardingDraft, startPipeline, launchMode, launching, run?.status]
  );

  const startTrialScan = useCallback(async (profileOverride?: Profile) => {
    if (!uid) return;
    if (launchMode === "unlock" && (launching || run?.status === "running" || run?.status === "pending")) {
      alert("Patientez : génération des CV et lettres des offres débloquées en cours.");
      return;
    }
    const draft = loadDraft();
    if (!draft) {
      alert("Profil de découverte introuvable. Reprenez l'onboarding pour lancer le scan.");
      return;
    }
    const effectiveProfile = profileOverride ?? profile;
    const effectiveDraft = {
      ...draft,
      cv_url: hasUploadedCv(effectiveProfile) ? effectiveProfile?.cv_url || draft.cv_url : draft.cv_url,
      cv_filename: effectiveProfile?.cv_filename || draft.cv_filename,
    };

    setLaunching(true);
    setLaunchMode("full");
    if (!isMobile) setSideTab("terminal");
    trackEvent("trial_scan_start_clicked", {
      has_cv: hasUploadedCv(effectiveProfile),
      plan: effectiveProfile?.plan_id ?? null,
    });

    try {
      const res = await fetch("/api/trial/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: effectiveDraft }),
      });
      const data = await parseApiJson<{
        error?: string;
        runId?: string;
        alreadyRunning?: boolean;
        existingSession?: boolean;
        trialUsed?: boolean;
        redirectTo?: string;
      }>(res);
      if (!res.ok || data.error) {
        if (data.trialUsed) {
          setTrialUsedBlock(true);
          await load(uid, false);
          return;
        }
        if (data.redirectTo && data.redirectTo !== "/dashboard") {
          router.push(data.redirectTo);
          return;
        }
        if (data.existingSession) {
          await load(uid, false);
          return;
        }
        throw new Error(data.error || "Recherche indisponible");
      }
      trackEvent("trial_scan_started", { already_running: !!data.alreadyRunning });
      if (!data.alreadyRunning) setJobs([]);
      await fetchRun();
      await load(uid, false);
    } catch (e) {
      trackEvent("trial_scan_start_error");
      setLaunchMode(null);
      alert((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }, [fetchRun, isMobile, launchMode, launching, load, profile, router, run?.status, uid]);

  useEffect(() => {
    if (!unlockTriggeredRef.current) return;
    if (run?.status === "failed" || run?.status === "cancelled") {
      unlockTriggeredRef.current = false;
    }
  }, [run?.status]);

  const handleCalibrationComplete = useCallback(
    (updated: Profile) => {
      const pending = pendingLaunchRef.current;
      pendingLaunchRef.current = null;
      setProfile(updated);
      setShowNoCvCalib(false);
      window.dispatchEvent(new CustomEvent("ja:prefs-updated"));
      if (updated.subscription_status === "trial" && !isTrialDiscoveryComplete(jobs)) {
        void startTrialScan(updated);
        return;
      }
      if (pending) void startPipeline(pending.mode, pending.urls, pending.importUrl);
    },
    [startPipeline, startTrialScan, jobs]
  );

  const stopPipeline = useCallback(async (finalizeFound = false) => {
    if (!run?.id) return;
    setShowStopConfirm(false);
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
      if (finalizeFound && uid) {
        const { data: currentJobs } = await supabase
          .from("jobs")
          .select("url,data,cv_url,fit_score")
          .eq("user_id", uid)
          .eq("deleted", false);

        const realJobs = (currentJobs ?? []).filter(
          (j) => !isTrialDecoyJob({ url: j.url ?? "", data: (j.data as Record<string, unknown>) ?? {} })
        );

        if (realJobs.length === 0) {
          setNoCompatibleNotice(true);
          return;
        }

        const pendingUnscored = realJobs.filter((j) => {
          const score = j.fit_score ?? (j.data as Record<string, unknown> | null)?._fit_score;
          return typeof score !== "number";
        });
        const qualifying = realJobs.filter((j) => {
          const score = j.fit_score ?? (j.data as Record<string, unknown> | null)?._fit_score;
          return typeof score === "number" && score >= MIN_READY_SCORE;
        });

        // Jamais de génération sous 6/10. S'il reste des offres non scorées,
        // on les analyse d'abord (le moteur ne génère ensuite que les ≥6).
        if (qualifying.length === 0 && pendingUnscored.length === 0) {
          setNoCompatibleNotice(true);
          return;
        }

        finalizeDocsPendingRef.current = true;
        await startPipeline("analyze");
      }
    } catch (e) {
      setRun(prevRun);
      alert((e as Error).message);
    } finally {
      setStopping(false);
    }
  }, [fetchRun, load, run, startPipeline, supabase, uid]);

  const requestStopPipeline = useCallback(() => {
    if (!run) return;
    if (isAutoapplyRun(run)) {
      void stopPipeline(false);
      return;
    }
    setShowStopConfirm(true);
  }, [run, stopPipeline]);

  useEffect(() => {
    if (!uid) return;
    load(uid);
    fetchRun();
    const onPrefs = () => load(uid, true);
    window.addEventListener("ja:prefs-updated", onPrefs);
    return () => window.removeEventListener("ja:prefs-updated", onPrefs);
  }, [uid, load, fetchRun]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("trial_used") === "1") {
      setTrialUsedBlock(true);
    }
  }, []);

  useEffect(() => {
    if (!uid || profile?.subscription_status !== "trial") return;
    void fetch("/api/trial/start", {
      method: "GET",
      credentials: "same-origin",
    });
  }, [uid, profile?.subscription_status]);

  useEffect(() => {
    if (!uid || loading || !profile) return;
    const isActive =
      profile.subscription_status === "active" ||
      profile.subscription_status === "trialing";
    if (!isActive || !hasUploadedCv(profile)) return;
    if (unlockTriggeredRef.current || launching) return;
    if (run?.status === "running" || run?.status === "pending") return;

    void (async () => {
      try {
        const res = await fetch("/api/trial/unlock-pending", { credentials: "same-origin" });
        const data = await parseApiJson<{ pending?: boolean; lockedCount?: number }>(res);
        if (!res.ok || !data.lockedCount) {
          // Decoys éventuellement purgés même sans dossiers à générer
          if (res.ok) await load(uid, true);
          return;
        }
        unlockTriggeredRef.current = true;
        await load(uid, true);
        setLaunchMode("unlock");
        if (!isMobile) setSideTab("terminal");
        await startPipeline("unlock");
      } catch {
        unlockTriggeredRef.current = false;
      }
    })();
  }, [uid, loading, profile, run?.status, launching, startPipeline, isMobile, load]);

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
    prevRunStatusRef.current = run.status;
  }, [run?.status]);

  // Après « Générer les dossiers trouvés » : si aucune offre ≥6/10, message clair.
  useEffect(() => {
    if (!finalizeDocsPendingRef.current) return;
    if (run?.status !== "done" && run?.status !== "failed" && run?.status !== "cancelled") return;
    finalizeDocsPendingRef.current = false;
    if (run.status !== "done") return;

    const qualifying = jobs.filter((j) => {
      if (isTrialDecoyJob(j) || isImportedJob(j)) return false;
      const score = getJobScore(j);
      return score != null && score >= MIN_READY_SCORE;
    });
    const generatedCount = Array.isArray(run.result?.generated_urls)
      ? run.result.generated_urls.length
      : 0;
    if (qualifying.length === 0 && generatedCount === 0) {
      setNoCompatibleNotice(true);
    }
  }, [run?.status, run?.result, jobs]);

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
  const eligibleUrls = useMemo(() => autoApplyEligible.map((j) => j.url), [autoApplyEligible]);
  const selectedEligibleUrls = useMemo(
    () => eligibleUrls.filter((url) => selectedUrls.has(url)),
    [eligibleUrls, selectedUrls]
  );

  useEffect(() => {
    setSelectedUrls((prev) => {
      const eligible = new Set(eligibleUrls);
      const next = new Set([...prev].filter((url) => eligible.has(url)));
      return next.size === prev.size ? prev : next;
    });
    if (selectMode && eligibleUrls.length === 0) {
      setSelectMode(false);
    }
  }, [eligibleUrls, selectMode]);

  const enterSelectMode = useCallback(() => {
    if (eligibleUrls.length === 0) return;
    setSelectedUrls(new Set(eligibleUrls));
    setSelectMode(true);
    setTab("generated");
  }, [eligibleUrls]);

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

  const selectAllEligible = useCallback(() => {
    setSelectedUrls(new Set(eligibleUrls));
  }, [eligibleUrls]);

  const clearSelection = useCallback(() => {
    setSelectedUrls(new Set());
  }, []);

  const launchAutoApply = useCallback(() => {
    const urls = selectMode ? selectedEligibleUrls : eligibleUrls;
    if (!uid || urls.length === 0) return;
    startPipeline("autoapply", urls);
    exitSelectMode();
  }, [uid, selectMode, selectedEligibleUrls, eligibleUrls, startPipeline, exitSelectMode]);

  const greeting = (() => {
    const name = (profile?.full_name || "").trim();
    // Nom mal extrait du CV (ex. un intitulé de poste) : on salue sans prénom.
    if (!isPlausiblePersonName(name)) return "Bonjour";
    const parts = name.split(/\s+/).filter(Boolean);
    // prénom seul si disponible, sinon nom complet
    const display = parts.length >= 2 ? parts[0] : name;
    return `Bonjour ${display}`;
  })();
  const runActive = run?.status === "running" || run?.status === "pending";
  const importLaunchPending = launching && launchMode === "import" && !runActive;
  const pipelineActive = !importLaunchPending && (launching || runActive);
  const unlocking =
    pipelineActive &&
    (launchMode === "unlock" ||
      run?.result?.mode === "unlock" ||
      /Déblocage de vos dossiers|dossier\(s\) débloqué/i.test(run?.log || ""));
  const isTrial = profile?.subscription_status === "trial";
  const trialDiscoveryComplete = useMemo(
    () => isTrial && isTrialDiscoveryComplete(jobs),
    [isTrial, jobs]
  );
  const trialPaywallLocked = useMemo(
    () => shouldShowTrialPaywall(profile?.subscription_status, jobs),
    [profile?.subscription_status, jobs]
  );
  const alwaysShowProductTour = isTrial || user?.is_anonymous === true;
  const trialSubscribeHref = upgradeSubscribePath(parsePlanId(profile?.plan_id));
  const openPaywall = useCallback(
    (context: PaywallContext) => {
      trackEvent("trial_paywall_shown", { context });
      setPaywallContext(context);
    },
    []
  );
  const jobsReadOnly =
    pipelineActive && launchMode !== "autoapply" && !isAutoapplyRun(run);

  useEffect(() => {
    if (!uid || !profile || loading || authLoading || showProductTour) return;
    if (productTourAutoOpenedRef.current) return;

    const searchDone = isTrial ? trialDiscoveryComplete : !!profile.first_search_done;

    if (pipelineActive) {
      // Clic trop rapide : un scan a démarré avant l'ouverture auto. On abandonne
      // le tuto pour cette session (pas de réouverture bizarre en fin de scan).
      if (productTourEligiblePendingRef.current) {
        productTourEligiblePendingRef.current = false;
        productTourAutoOpenedRef.current = true;
        clearForcedDashboardProductTour();
      }
      return;
    }

    if (!shouldOfferDashboardProductTour(searchDone)) return;

    productTourEligiblePendingRef.current = true;
    const t = window.setTimeout(() => {
      productTourEligiblePendingRef.current = false;
      productTourAutoOpenedRef.current = true;
      clearForcedDashboardProductTour();
      setShowProductTour(true);
    }, 900);
    return () => window.clearTimeout(t);
  }, [
    uid,
    profile,
    loading,
    authLoading,
    pipelineActive,
    showProductTour,
    profile?.first_search_done,
    trialDiscoveryComplete,
    isTrial,
  ]);

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
  const showPoorFitAlert = !hidePoorFitAlert && !!fitHealth && isPoorFitHealth(fitHealth);

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
  const quotaUsage = useMemo(
    () => getQuotaUsage(plan, quotaOpts, profile?.subscription_status),
    [plan, quotaOpts, profile?.subscription_status]
  );
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
  const importBlockReason = useMemo(
    () => pipelineQuotaBlockReason(plan, "import", quotaOpts),
    [plan, quotaOpts]
  );
  const generationBlocked = !!scanBlockReason || !!analyzeBlockReason;

  const showFirstSearch =
    !loading &&
    !authLoading &&
    !(isTrial ? trialDiscoveryComplete : profile?.first_search_done) &&
    jobs.length === 0 &&
    !pipelineActive &&
    !showProductTour;

  const pendingAnalysis = useMemo(
    () => jobs.filter((j) => !isImportedJob(j) && getJobScore(j) == null).length,
    [jobs]
  );

  return (
    <>
      <main
        className={`db__main db__main--with-terminal${trialUsedBlock ? " db__main--blocked" : ""}`}
        aria-hidden={trialUsedBlock || undefined}
      >
        <div className="db__hello">
          <h1>{greeting}</h1>
          {!showFirstSearch && (
            <p className="db__hello-sub">
              {profile?.target_roles?.length
                ? profile.target_roles.join(" · ")
                : "Configurez votre recherche pour démarrer."}
              {!loading && !isTrial && (
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

        <div
          className={`db-page-split${showFirstSearch ? " db-page-split--first" : ""}${isMobile ? " db-page-split--mobile" : ""}`}
        >
          <div className={`db-page-main${selectMode ? " db-page-main--selecting" : ""}`}>
        {showFirstSearch && (
          <section className="db-first" aria-labelledby="first-search-title">
            <h2 id="first-search-title" className="db-first__title">
              Votre premier scan
            </h2>
            <p className="db-first__lead">
              {isTrial
                ? "On passe le marché au crible. Vos meilleures offres arrivent avec CV et lettre déjà prêts."
                : "LinkedIn est parcouru selon votre profil. Jusqu'à 15 bons matchs reçoivent une note, un CV et une lettre prêts à soumettre."}
            </p>
            <div className="db-first__foot">
              <button
                type="button"
                className="db-first__cta"
                disabled={launching}
                onClick={() => {
                  if (!uid) return;
                  const launch = () => {
                    if (isTrial) {
                      if (!hasUploadedCv(profile)) {
                        pendingLaunchRef.current = { mode: "full" };
                        setShowNoCvCalib(true);
                        return;
                      }
                      void startTrialScan();
                      return;
                    }
                    requestPipelineLaunch();
                  };
                  // Tuto avant le 1er scan si l'utilisateur clique trop vite.
                  if (
                    !productTourAutoOpenedRef.current &&
                    !showProductTour &&
                    shouldOfferDashboardProductTour(false)
                  ) {
                    pendingTourActionRef.current = launch;
                    productTourAutoOpenedRef.current = true;
                    productTourEligiblePendingRef.current = false;
                    clearForcedDashboardProductTour();
                    setShowProductTour(true);
                    return;
                  }
                  launch();
                }}
              >
                {launching ? "Lancement…" : isTrial ? "Lancer ma recherche" : "Lancer la recherche"}
              </button>
            </div>
          </section>
        )}

        {showFirstSearch && isMobile && (
          <div className="db-terminal-mini" aria-label="Terminal compact">
            <PipelineLog run={run} variant="mini" starting={launching} />
          </div>
        )}

        {!showFirstSearch && (
          <>
        {showPoorFitAlert && fitHealth && (
          <PoorFitAlert
            health={fitHealth}
            roles={profile?.target_roles}
            onClose={() => setHidePoorFitAlert(true)}
          />
        )}

        {agentDeepLink && (
          <AgentLaunchBanner
            onRetry={retryAgentDeepLink}
            awaitingAgent={agentAwaiting}
          />
        )}

        {unlocking && (
          <div className="db-unlock-banner" role="status" aria-live="polite">
            <span className="db-unlock-banner__pulse" aria-hidden="true" />
            <p className="db-unlock-banner__text">
              Déblocage de vos dossiers… génération des CV et lettres en cours.
            </p>
          </div>
        )}

        {pipelineActive ? (
          <>
            <PipelineProgress
              run={run}
              jobsFound={jobs.length}
              targetRoles={profile?.target_roles}
              compact={isMobile}
              onStop={requestStopPipeline}
              stopping={stopping}
              launching={launching}
              launchMode={launchMode}
              trialDiscovery={isTrial}
            />
            {unlocking && (
              <DashboardActionsBar
                launching
                unlocking
                onSearch={() =>
                  alert(
                    "Patientez : génération des CV et lettres des offres débloquées en cours."
                  )
                }
                scanDisabled
                scanDisabledReason="Génération des CV et lettres des offres débloquées en cours."
                applyCount={autoApplyEligible.length}
                totalJobs={jobs.length}
                desktopOnly={isMobile}
              />
            )}
          </>
        ) : (
          <>
            {pendingAnalysis > 0 && !analyzeBlockReason && (
              <AnalyzePendingCta
                count={pendingAnalysis}
                launching={launching}
                onAnalyze={() =>
                  trialPaywallLocked ? openPaywall("analyze") : requestPipelineLaunch("analyze")
                }
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
              onSearch={() => {
                if (isTrial) {
                  if (trialPaywallLocked) openPaywall("scan");
                  else void startTrialScan();
                  return;
                }
                requestPipelineLaunch();
              }}
              scanDisabled={!isTrial && !!scanBlockReason}
              scanDisabledReason={isTrial ? null : scanBlockReason}
              scanUpgrade={isTrial ? null : scanUpgrade}
              applyCount={autoApplyEligible.length}
              totalJobs={jobs.length}
              desktopOnly={isMobile}
              onStartApply={trialPaywallLocked ? () => openPaywall("apply") : enterSelectMode}
            />
          </>
        )}

        {jobsReadOnly && filtered.length > 0 && (
          <LiveJobsNotice count={filtered.length} run={run} launchMode={launchMode} />
        )}

        {isMobile && (
          <div className="db-terminal-mini db-terminal-mini--inline" aria-label="Terminal compact">
            <PipelineLog run={run} variant="mini" starting={launching} />
          </div>
        )}

        {selectMode && (
          <div className="db-select-banner">
            <div className="db-select-banner__body">
              <p className="db-select-banner__title">Choisissez les offres à postuler</p>
              <p className="db-select-banner__hint">
                Seules les offres non postulées avec CV + lettre et score ≥ 6 sont sélectionnables.
              </p>
            </div>
            <div className="db-select-banner__aside">
              <span className="db-select-banner__count">{selectedEligibleUrls.length}</span>
              <button type="button" className="db-select-banner__quit" onClick={exitSelectMode}>
                Annuler
              </button>
            </div>
          </div>
        )}

        <div className={`db__jobs-head${selectMode ? " db__jobs-head--selecting" : ""}`}>
          <div className="db__jobs-head-left">
            <h2 className="db__jobs-title">Vos offres</h2>
            <StatFilterChips stats={stats} tab={tab} onChange={setTab} />
          </div>
          {!pipelineActive && (
            <ImportOfferCta
              launching={launching}
              disabled={!isTrial && !!importBlockReason}
              disabledReason={isTrial ? null : importBlockReason}
              onImport={(url) =>
                trialPaywallLocked
                  ? openPaywall("import")
                  : requestPipelineLaunch("import", undefined, url)
              }
            />
          )}
        </div>

        {loading || authLoading ? (
          <div className="db__empty">Chargement…</div>
        ) : pipelineActive && filtered.length === 0 ? (
          <ScanJobsWaiting />
        ) : (
          <div className="db__jobs-slot" data-tour="jobs-slot">
            {filtered.length === 0 ? (
              <div className="db__empty">
                <div className="db__empty-emoji">🛰️</div>
                <h3>Aucune offre pour l&apos;instant</h3>
                <p>Lancez une nouvelle recherche ci-dessus pour scanner LinkedIn selon vos critères.</p>
              </div>
            ) : (
              <div data-tour="jobs-section">
                <JobList
                  jobs={filtered}
                  isFresh={isFresh}
                  onToggleApplied={toggleApplied}
                  pipelineActive={pipelineActive}
                  readOnly={jobsReadOnly}
                  profile={profile}
                  selectMode={selectMode}
                  selectedUrls={selectedUrls}
                  onToggleSelect={toggleSelectUrl}
                  trialLocked={trialPaywallLocked}
                  onPaywall={openPaywall}
                  onNameSaved={(fullName) =>
                    setProfile((p) => (p ? { ...p, full_name: fullName } : p))
                  }
                />
              </div>
            )}
          </div>
        )}

        {selectMode && (
          <div className="db-auto-bar db-auto-bar--select">
            <div className="db-auto-bar__summary">
              <span className="db-auto-bar__count">{selectedEligibleUrls.length}</span>
              <span className="db-auto-bar__label">
                offre{selectedEligibleUrls.length > 1 ? "s" : ""} sélectionnée{selectedEligibleUrls.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="db-auto-bar__actions">
              <button type="button" className="db-auto-bar__toggle" onClick={selectAllEligible}>
                Tout sélectionner
              </button>
              <button type="button" className="db-auto-bar__toggle" onClick={clearSelection}>
                Tout retirer
              </button>
              <button
                type="button"
                className="db-big-btn db-big-btn--apply db-auto-bar__launch"
                disabled={selectedEligibleUrls.length === 0 || launching}
                onClick={() => setShowAutoTuto(true)}
              >
                <span>{launching ? "Lancement…" : "Lancer Postuler"}</span>
                <span className="db-big-btn__beta">beta</span>
              </button>
            </div>
          </div>
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
              <PipelineLog run={run} starting={launching} />
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
      {showProductTour && (
        <DashboardProductTour
          onClose={() => {
            setShowProductTour(false);
            const pending = pendingTourActionRef.current;
            pendingTourActionRef.current = null;
            if (pending) pending();
          }}
          persistSeen={!alwaysShowProductTour}
        />
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
      {showStopConfirm && (
        <StopSearchConfirmModal
          stopping={stopping}
          onClose={() => setShowStopConfirm(false)}
          onStopNow={() => stopPipeline(false)}
          onFinalize={() => stopPipeline(true)}
        />
      )}
      {paywallContext && (
        <TrialPaywallModal
          context={paywallContext}
          subscribeHref={trialSubscribeHref}
          onClose={() => setPaywallContext(null)}
        />
      )}
      {trialUsedBlock && <TrialUsedBlock source="dashboard" />}
      {noCompatibleNotice && (
        <NoCompatibleOffersModal onClose={() => setNoCompatibleNotice(false)} />
      )}
    </>
  );
}

function NoCompatibleOffersModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="stop-modal__overlay" role="presentation" onClick={onClose}>
      <div
        className="stop-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-compatible-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="stop-modal__close"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>
        <p className="stop-modal__eyebrow">Aucune génération</p>
        <h2 id="no-compatible-title" className="stop-modal__title">
          Aucune offre compatible
        </h2>
        <p className="stop-modal__text">
          Aucune offre à 6/10 ou plus n&apos;a été trouvée. Aucun CV ni lettre n&apos;a
          été généré. Relancez un scan en adaptant vos critères (poste, lieu, type de
          contrat) pour de meilleurs matchs.
        </p>
        <div className="stop-modal__actions">
          <Link href="/dashboard/preferences" className="stop-modal__primary" onClick={onClose}>
            Adapter mes critères
          </Link>
          <button type="button" className="stop-modal__secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

function StopSearchConfirmModal({
  stopping,
  onClose,
  onStopNow,
  onFinalize,
}: {
  stopping: boolean;
  onClose: () => void;
  onStopNow: () => void;
  onFinalize: () => void;
}) {
  return (
    <div className="stop-modal__overlay" role="presentation" onClick={onClose}>
      <div
        className="stop-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="stop-modal__close"
          aria-label="Fermer"
          onClick={onClose}
          disabled={stopping}
        >
          ×
        </button>
        <p className="stop-modal__eyebrow">Recherche en cours</p>
        <h2 id="stop-modal-title" className="stop-modal__title">
          Que fait-on des offres déjà trouvées ?
        </h2>
        <p className="stop-modal__text">
          Seules les offres à 6/10 ou plus reçoivent un CV et une lettre. Les notes
          en dessous ne génèrent jamais de dossier.
        </p>
        <div className="stop-modal__actions">
          <button
            type="button"
            className="stop-modal__primary"
            onClick={onFinalize}
            disabled={stopping}
          >
            {stopping ? "Arrêt…" : "Générer les dossiers ≥ 6/10"}
          </button>
          <button
            type="button"
            className="stop-modal__secondary"
            onClick={onStopNow}
            disabled={stopping}
          >
            Stopper tout
          </button>
        </div>
      </div>
    </div>
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
  unlocking = false,
  onSearch,
  scanDisabled,
  scanDisabledReason,
  scanUpgrade,
  applyCount,
  totalJobs = 0,
  desktopOnly = false,
  onStartApply,
}: {
  launching: boolean;
  unlocking?: boolean;
  onSearch: () => void;
  scanDisabled?: boolean;
  scanDisabledReason?: string | null;
  scanUpgrade?: UpgradeOffer | null;
  applyCount?: number;
  totalJobs?: number;
  desktopOnly?: boolean;
  onStartApply?: () => void;
}) {
  const total = applyCount ?? 0;
  const canApply = total > 0 && !desktopOnly && !unlocking;

  // Message expliquant pourquoi l'auto-apply n'est pas disponible
  const applyBlockReason = unlocking
    ? "Patientez la fin du déblocage des dossiers."
    : desktopOnly
    ? "Postuler est disponible uniquement sur ordinateur."
    : !canApply
      ? totalJobs === 0
      ? "Lancez d'abord une recherche pour obtenir des offres."
      : "Aucune offre avec CV + lettre générés (score ≥ 6). Lancez une recherche."
      : null;

  const scanBusy = launching || unlocking;
  const scanLabel = unlocking ? "Déblocage…" : launching ? "Lancement…" : "Scanner";
  const highlightScan = totalJobs > 0 && !scanBusy && !scanDisabled;

  return (
    <div className="db-acts-wrap">
      <div className="db-acts-btns">
        {scanDisabled && scanUpgrade && !scanUpgrade.isMaxPlan && !unlocking ? (
          <Link
            href={scanUpgrade.href}
            className="db-big-btn db-big-btn--upgrade"
            aria-label={`Obtenir plus de dossiers, passer au plan ${scanUpgrade.name}`}
          >
            Plus de dossiers
          </Link>
        ) : (
          <div className="db-scan-wrap">
            {highlightScan && (
              <span className="db-scan-hint" aria-hidden="true">
                Des centaines d&apos;autres offres vous attendent
              </span>
            )}
            <button
              type="button"
              className={`db-big-btn${unlocking ? " db-big-btn--unlocking" : ""}${
                highlightScan ? " db-big-btn--scan-hot" : ""
              }`}
              data-tour="scan-btn"
              disabled={scanBusy || scanDisabled}
              onClick={onSearch}
              title={scanDisabledReason ?? undefined}
            >
              {highlightScan && <span className="db-big-btn__radar" aria-hidden="true" />}
              <span className="db-big-btn__label">{scanLabel}</span>
            </button>
          </div>
        )}

        <button
          type="button"
          className="db-big-btn db-big-btn--apply"
          data-tour="apply-btn"
          disabled={!canApply}
          onClick={canApply ? onStartApply : undefined}
          title={applyBlockReason ?? undefined}
        >
          <span>Postuler</span>
          <span className="db-big-btn__beta">beta</span>
        </button>
      </div>

      {!canApply && applyBlockReason && (
        <p className="db-acts-apply-hint">{applyBlockReason}</p>
      )}

      {scanDisabled && scanDisabledReason && (!scanUpgrade || scanUpgrade.isMaxPlan) && (
        <p className="db-acts-apply-hint">
          {scanDisabledReason}{" "}
          <Link href={buyCreditsPath()} className="db-acts-upgrade-link">
            Acheter des dossiers
          </Link>
        </p>
      )}
    </div>
  );
}


function ImportOfferCta({
  launching,
  disabled,
  disabledReason,
  onImport,
  compact = false,
}: {
  launching: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  onImport: (url: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [url, setUrl] = useState("");
  const trimmed = url.trim();
  const canSubmit = !launching && !disabled && /^https?:\/\/\S+\.\S+/.test(trimmed);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onImport(trimmed);
    setUrl("");
  };

  return (
    <div className={`db-import-offer${compact ? " db-import-offer--compact" : ""}`}>
      {launching ? (
        <div className="db-import-offer__pending" role="status" aria-live="polite">
          <span className="db-run__inline-loader-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Préparation de l&apos;import…</span>
        </div>
      ) : !open ? (
        <div className="db-import-offer__toggle-wrap">
          <button
            type="button"
            className="db-import-offer__toggle"
            disabled={disabled}
            title={disabledReason ?? undefined}
            onClick={() => setOpen(true)}
          >
            Importer une offre par lien
          </button>
          <button
            type="button"
            className={`db-import-offer__help-btn${helpOpen ? " is-open" : ""}`}
            aria-label="Comment ça marche ?"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          >
            ?
          </button>
          {helpOpen && (
            <div className="db-import-offer__help" role="note">
              <p className="db-import-offer__help-title">Importer une offre par lien</p>
              <p>
                Collez le lien d&apos;une offre trouvée ailleurs (LinkedIn, site d&apos;entreprise…).
                On l&apos;analyse, on la note sur 10 et on prépare un CV + une lettre adaptés,
                comme pour les offres trouvées automatiquement.
              </p>
              <button
                type="button"
                className="db-import-offer__help-close"
                onClick={() => setHelpOpen(false)}
              >
                Compris
              </button>
            </div>
          )}
        </div>
      ) : (
        <form className="db-import-offer__form" onSubmit={submit}>
          <label className="db-import-offer__label" htmlFor={compact ? "first-import-url" : "import-url"}>
            Lien de l&apos;offre
          </label>
          <div className="db-import-offer__row">
            <input
              id={compact ? "first-import-url" : "import-url"}
              className="db-import-offer__input"
              type="url"
              inputMode="url"
              value={url}
              disabled={launching || disabled}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.linkedin.com/jobs/..."
            />
            <button
              type="submit"
              className="db-import-offer__submit"
              disabled={!canSubmit}
              title={disabledReason ?? undefined}
            >
              Importer
            </button>
            <button
              type="button"
              className="db-import-offer__cancel"
              onClick={() => {
                setOpen(false);
                setUrl("");
              }}
            >
              Annuler
            </button>
          </div>
        </form>
      )}
      {disabled && disabledReason && <p className="db-import-offer__error">{disabledReason}</p>}
    </div>
  );
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
  onClose,
}: {
  health: FitHealth;
  roles?: string[] | null;
  onClose: () => void;
}) {
  const rolesLabel = roles?.length ? roles.join(", ") : "vos mots-clés";
  return (
    <div className="db__fit-alert" role="alert">
      <div className="db__fit-alert-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </svg>
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
      <button
        type="button"
        className="db__fit-alert-close"
        onClick={onClose}
        aria-label="Fermer l'alerte"
      >
        ×
      </button>
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

type PaywallContext =
  | "scan"
  | "docs"
  | "apply"
  | "rewrite_letter"
  | "rewrite_cv"
  | "import"
  | "analyze";

const PAYWALL_COPY: Record<PaywallContext, { title: string; text: string }> = {
  docs: {
    title: "Ce dossier est prêt, il ne reste qu'à le débloquer",
    text: "Le CV et la lettre adaptés à cette offre sont prêts. Choisissez une formule pour débloquer ce dossier et les suivants.",
  },
  scan: {
    title: "Relancer un scan",
    text: "Votre première recherche est terminée. Choisissez une formule pour relancer des recherches complètes illimitées.",
  },
  apply: {
    title: "Postuler automatiquement",
    text: "L'auto-apply envoie vos candidatures à votre place, CV et lettre inclus. Disponible dès que vous choisissez un plan.",
  },
  rewrite_letter: {
    title: "Votre essai de retouche de lettre est terminé",
    text: "Vous avez utilisé votre modification gratuite. Choisissez une formule pour retoucher toutes vos lettres à volonté.",
  },
  rewrite_cv: {
    title: "Votre essai de modification de CV est terminé",
    text: "Vous avez utilisé votre modification gratuite. Choisissez une formule pour adapter tous vos CV à volonté.",
  },
  import: {
    title: "Importer une offre",
    text: "L'import d'offres trouvées à la main est réservé aux membres. Débloquez-le avec toutes les autres options.",
  },
  analyze: {
    title: "Analyser plus d'offres",
    text: "L'analyse des offres en attente est réservée aux membres. Débloquez-la pour scorer tout ce qui a été trouvé.",
  },
};

function TrialPaywallModal({
  context,
  subscribeHref,
  onClose,
}: {
  context: PaywallContext;
  subscribeHref: string;
  onClose: () => void;
}) {
  const copy = PAYWALL_COPY[context];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="trial-paywall__overlay" role="presentation" onClick={onClose}>
      <div
        className="trial-paywall"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-paywall-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="trial-paywall__close"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>
        <div className="trial-paywall__lock" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
          </svg>
        </div>
        <h2 id="trial-paywall-title" className="trial-paywall__title">
          {copy.title}
        </h2>
        <p className="trial-paywall__text">{copy.text}</p>
        <ul className="trial-paywall__perks">
          <li>CV + lettre générés pour chaque bonne offre</li>
          <li>Scan illimité</li>
          <li>Auto-apply : candidatures envoyées pour vous</li>
        </ul>
        <div className="trial-paywall__actions">
          <Link
            href={subscribeHref}
            className="btn btn--coral trial-paywall__cta"
            onClick={() => trackEvent("trial_paywall_cta_clicked", { context })}
          >
            Débloquer maintenant
          </Link>
          <button type="button" className="trial-paywall__later" onClick={onClose}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}

function LiveJobsNotice({
  count,
  run,
  launchMode,
}: {
  count: number;
  run: PipelineRun | null;
  launchMode?: PipelineStartMode | null;
}) {
  const phase = parsePipelinePhase(run, count);
  const isGenerating =
    launchMode === "unlock" ||
    run?.result?.mode === "unlock" ||
    ["generate", "sync", "done"].includes(phase.subPhase);
  const isScoring = ["analyze", "hunt_fill"].includes(phase.subPhase);

  const { title, text } = isGenerating
    ? {
        title: "Vos dossiers arrivent",
        text: `${count} offre${count > 1 ? "s" : ""} retenue${count > 1 ? "s" : ""}. Vos CV et lettres de motivation arrivent dans un instant.`,
      }
    : isScoring
      ? {
          title: "Analyse des offres en cours",
          text: `${count} offre${count > 1 ? "s" : ""} détectée${count > 1 ? "s" : ""}. Notation puis génération des CV et lettres à suivre.`,
        }
      : {
          title: "Scan en cours, les offres arrivent",
          text: `${count} offre${count > 1 ? "s" : ""} détectée${count > 1 ? "s" : ""}. Génération des CV et lettres de motivation à la fin du scan.`,
        };

  return (
    <div className="db-live-lock" role="status" aria-live="polite">
      <span className="db-live-lock__spinner" aria-hidden="true" />
      <div>
        <p className="db-live-lock__title">{title}</p>
        <p className="db-live-lock__text">{text}</p>
      </div>
    </div>
  );
}

function JobList({
  jobs,
  isFresh,
  onToggleApplied,
  pipelineActive,
  readOnly,
  profile,
  selectMode,
  selectedUrls,
  onToggleSelect,
  trialLocked,
  onPaywall,
  onNameSaved,
}: {
  jobs: Job[];
  isFresh: (j: Job) => boolean;
  onToggleApplied: (url: string) => void;
  pipelineActive?: boolean;
  readOnly?: boolean;
  profile: Profile | null;
  selectMode?: boolean;
  selectedUrls?: Set<string>;
  onToggleSelect?: (url: string) => void;
  trialLocked?: boolean;
  onPaywall?: (context: PaywallContext) => void;
  onNameSaved?: (fullName: string) => void;
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
            analyzing={!isImportedJob(j) && getJobScore(j) == null}
            readOnly={readOnly}
            onToggleApplied={readOnly ? undefined : () => onToggleApplied(j.url)}
            profile={profile}
            trialLocked={trialLocked}
            onPaywall={onPaywall}
            onNameSaved={onNameSaved}
            {...(readOnly ? {} : rowSelectProps(j))}
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
            trialLocked={trialLocked}
            onPaywall={onPaywall}
            onNameSaved={onNameSaved}
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
          readOnly={readOnly}
          profile={profile}
          trialLocked={trialLocked}
          onPaywall={onPaywall}
          onNameSaved={onNameSaved}
          selectMode={readOnly ? false : selectMode}
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
  readOnly,
  entering,
  profile,
  trialLocked,
  onPaywall,
  onNameSaved,
  selectMode,
  selectedUrls,
  onToggleSelect,
}: {
  jobs: Job[];
  isFresh: (j: Job) => boolean;
  onToggleApplied: (url: string) => void;
  readOnly?: boolean;
  entering?: Set<string>;
  profile: Profile | null;
  trialLocked?: boolean;
  onPaywall?: (context: PaywallContext) => void;
  onNameSaved?: (fullName: string) => void;
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
              readOnly={readOnly}
              onToggleApplied={readOnly ? undefined : () => onToggleApplied(j.url)}
              profile={profile}
              trialLocked={trialLocked}
              onPaywall={onPaywall}
              onNameSaved={onNameSaved}
              selectMode={readOnly ? false : selectMode}
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
  readOnly,
  onToggleApplied,
  profile,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
  trialLocked,
  onPaywall,
  onNameSaved,
}: {
  job: Job;
  fresh?: boolean;
  compact?: boolean;
  entering?: boolean;
  enterDelay?: number;
  analyzing?: boolean;
  readOnly?: boolean;
  onToggleApplied?: () => void;
  profile: Profile | null;
  selectMode?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  trialLocked?: boolean;
  onPaywall?: (context: PaywallContext) => void;
  onNameSaved?: (fullName: string) => void;
}) {
  const d = job.data || {};
  const title = (d.title as string) || "Offre";
  const company = (d.company as string) || "";
  const location = (d.location as string) || "";
  const url = (d.url as string) || job.url;
  const imported = isImportedJob(job);
  const isDecoy = isTrialDecoyJob(job);
  const score = getJobScore(job);
  const fitTier = getFitTier(score);
  const fitReasoning = getJobFitReasoning(job);
  const docsUnavailable = isJobReadyWithoutCv(job) && !job.cv_url;
  const profileHasCv = hasUploadedCv(profile);
  const openDecoyPaywall = () => {
    trackEvent("trial_decoy_clicked");
    onPaywall?.("docs");
  };
  // Mode essai avec CV : offre qualifiante sans documents générés → dossier "prêt" mais verrouillé.
  const trialTeaser =
    (isDecoy && !!trialLocked) ||
    (!!trialLocked &&
      profileHasCv &&
      !analyzing &&
      !job.cv_url &&
      !job.letter_url &&
      ((score ?? 0) >= 6 || isJobReadyWithoutCv(job)));
  const trialMissingCvDocs =
    !!trialLocked &&
    !profileHasCv &&
    !analyzing &&
    !job.cv_url &&
    ((score ?? 0) >= 6 || isJobReadyWithoutCv(job));

  const [letterOpen, setLetterOpen] = useState(false);
  const [cvOpen, setCvOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [justSent, setJustSent] = useState(false);
  const [noBaseCvOpen, setNoBaseCvOpen] = useState(false);
  const canExpandDetail = !!fitReasoning && !analyzing;
  const showDetail = canExpandDetail && (detailOpen || readOnly);
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
        imported ? "jr--imported" : "",
        isDecoy ? "jr--decoy" : "",
        canExpandDetail ? "jr--expandable" : "",
        readOnly ? "jr--readonly" : "",
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
      onClick={isDecoy && trialLocked && !readOnly ? openDecoyPaywall : undefined}
      onKeyDown={
        isDecoy && trialLocked && !readOnly
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openDecoyPaywall();
              }
            }
          : undefined
      }
      role={isDecoy && trialLocked && !readOnly ? "button" : undefined}
      tabIndex={isDecoy && trialLocked && !readOnly ? 0 : undefined}
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
          role={readOnly ? undefined : "button"}
          tabIndex={readOnly ? undefined : 0}
          aria-expanded={readOnly ? undefined : detailOpen}
          onClick={readOnly ? undefined : () => setDetailOpen((open) => !open)}
          onKeyDown={(e) => {
            if (readOnly) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setDetailOpen((open) => !open);
            }
          }}
        >
          <div
            className={[
              "jr__dial",
              imported ? "jr__dial--imported" : "",
              score == null && !imported ? "is-na" : "",
              compact ? "jr__dial--sm" : "",
              analyzing ? "jr__dial--loading" : "",
              (fitTier === "10" || fitTier === "9") && score != null && !analyzing && !imported
                ? "jr__dial--wow"
                : "",
              fitTier === "8" && score != null && !analyzing && !imported
                ? "jr__dial--wow2"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={score != null && !analyzing ? getScoreDialStyle(score) : undefined}
            aria-label={
              imported
                ? "Offre importée"
                : analyzing
                ? "Analyse en cours"
                : score != null
                  ? `Score ${score} sur 10`
                  : "Non analysée"
            }
          >
            {imported ? (
              <span className="jr__dial-imported">Importé</span>
            ) : analyzing ? (
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
              <h3 className={`jr__title${isDecoy ? " jr__decoy-blur" : ""}`}>{title}</h3>
              {!readOnly && (
                <span className="jr__chev" aria-hidden="true">
                  ▾
                </span>
              )}
              {isDecoy && !compact && (
                <span className="jr__pill jr__pill--decoy">Dossier prêt</span>
              )}
              {fresh &&
                !compact &&
                !job.applied &&
                !analyzing &&
                fitTier !== "10" &&
                fitTier !== "9" && (
                  <span className="jr__pill jr__pill--new">new</span>
                )}
              {analyzing && (
                <span className="jr__pill jr__pill--analyzing">
                  <span className="jr__pill-dot" aria-hidden="true" />
                  Analyse
                </span>
              )}
              {imported && !compact && (
                <span className="jr__pill jr__pill--imported">Importé</span>
              )}
            </div>
            <p className={`jr__meta${isDecoy ? " jr__decoy-blur" : ""}`}>
              {company}
              {location ? ` · ${location}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <>
      <div
        className={[
          "jr__dial",
          imported ? "jr__dial--imported" : "",
          score == null && !imported ? "is-na" : "",
          compact ? "jr__dial--sm" : "",
          analyzing ? "jr__dial--loading" : "",
          job.applied ? "jr__dial--sent" : "",
          (fitTier === "10" || fitTier === "9") && score != null && !analyzing && !imported
            ? "jr__dial--wow"
            : "",
          fitTier === "8" && score != null && !analyzing && !imported
            ? "jr__dial--wow2"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={score != null && !analyzing ? getScoreDialStyle(score) : undefined}
        aria-label={
          imported
            ? "Offre importée"
            : analyzing
            ? "Analyse en cours"
            : score != null
              ? `Score ${score} sur 10`
              : "Non analysée"
        }
      >
        {imported ? (
          <span className="jr__dial-imported">Importé</span>
        ) : analyzing ? (
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
          <h3 className={`jr__title${isDecoy ? " jr__decoy-blur" : ""}`}>{title}</h3>
          {isDecoy && !compact && (
            <span className="jr__pill jr__pill--decoy">Dossier prêt</span>
          )}
          {fresh &&
            !compact &&
            !job.applied &&
            !analyzing &&
            fitTier !== "10" &&
            fitTier !== "9" && (
              <span className="jr__pill jr__pill--new">new</span>
            )}
          {analyzing && (
            <span className="jr__pill jr__pill--analyzing">
              <span className="jr__pill-dot" aria-hidden="true" />
              Analyse
            </span>
          )}
          {imported && !compact && (
            <span className="jr__pill jr__pill--imported">Importé</span>
          )}
        </div>
        <p className={`jr__meta${isDecoy ? " jr__decoy-blur" : ""}`}>
          {company}
          {location ? ` · ${location}` : ""}
        </p>
      </div>
        </>
      )}
      {!readOnly && (
      <div className="jr__actions" onClick={(e) => canExpandDetail && e.stopPropagation()}>
        <div className="jr__actions-body">
        {!compact && trialTeaser && (
          <>
            <button
              type="button"
              className="jr__doc jr__doc--cv jr__doc--teaser"
              onClick={(e) => {
                e.stopPropagation();
                onPaywall?.("docs");
              }}
              title="CV prêt : débloquez pour le consulter"
            >
              CV
              <svg className="jr__doc-lock" width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="jr__doc jr__doc--letter jr__doc--teaser"
              onClick={(e) => {
                e.stopPropagation();
                onPaywall?.("docs");
              }}
              title="Lettre prête : débloquez pour la consulter"
            >
              Lettre
              <svg className="jr__doc-lock" width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </>
        )}
        {!compact && !trialTeaser && !profileHasCv && !job.cv_url && (docsUnavailable || trialMissingCvDocs || !!job.letter_url) && (
          <span className="jr__doc-wrap">
            <button
              type="button"
              className="jr__doc jr__doc--cv"
              onClick={(e) => {
                e.stopPropagation();
                setNoBaseCvOpen((v) => !v);
              }}
              aria-expanded={noBaseCvOpen}
            >
              CV
            </button>
            {noBaseCvOpen && (
              <span className="jr__doc-pop" role="status">
                La personnalisation du CV n&apos;a pas pu se faire : aucun CV de base fourni.
                <button
                  type="button"
                  className="jr__doc-pop-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNoBaseCvOpen(false);
                  }}
                >
                  OK
                </button>
              </span>
            )}
          </span>
        )}
        {!compact && job.cv_url && (
          <button
            type="button"
            className="jr__doc jr__doc--cv"
            onClick={() => setCvOpen(true)}
            title="Voir et modifier le CV"
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
        {!isDecoy && url && (
          <a className="jr__link" href={url} target="_blank" rel="noopener">
            {compact ? "Voir" : "voir l'offre"}
          </a>
        )}
        {isDecoy && (
          <button
            type="button"
            className="jr__link"
            onClick={(e) => {
              e.stopPropagation();
              openDecoyPaywall();
            }}
          >
            {compact ? "Voir" : "voir l'offre"}
          </button>
        )}
        </div>
        {!compact && onToggleApplied && (
          <button
            type="button"
            className={[
              "jr__mark",
              job.applied ? "jr__mark--done" : "",
              isDecoy ? "jr__mark--locked" : "",
              !isDecoy && !canToggleAppliedMark(job) ? "jr__mark--idle" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={handleToggleApplied}
            disabled={!canToggleAppliedMark(job)}
            title={
              !canToggleAppliedMark(job)
                ? undefined
                : job.applied
                  ? "Marquer comme non candidaté"
                  : "Marquer comme candidaté"
            }
            aria-pressed={!!job.applied}
            aria-hidden={!canToggleAppliedMark(job)}
            tabIndex={!canToggleAppliedMark(job) ? -1 : 0}
          >
            ✓
          </button>
        )}
      </div>
      )}
      {readOnly && (
        <div className="jr__actions jr__actions--locked" aria-hidden="true">
          <span className="jr__locked-pill">Actions disponibles après le scan</span>
        </div>
      )}
      {showDetail && (
        <div
          className={[
            "jr__detail",
            compact ? "" : "jr__detail--full",
            readOnly && !detailOpen ? "jr__detail--clamped" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <p className="jr__detail-text">{fitReasoning}</p>
          {readOnly && !detailOpen && (
            <button
              type="button"
              className="jr__detail-more"
              onClick={(e) => {
                e.stopPropagation();
                setDetailOpen(true);
              }}
              aria-label="Voir toute l'analyse"
            >
              …
            </button>
          )}
          {readOnly && detailOpen && (
            <button
              type="button"
              className="jr__detail-less"
              onClick={(e) => {
                e.stopPropagation();
                setDetailOpen(false);
              }}
            >
              Réduire
            </button>
          )}
        </div>
      )}
      {letterOpen && job.letter_url && (
        <LetterModal
          company={company}
          title={title}
          letterUrl={job.letter_url}
          profile={profile}
          onLockedRefine={
            trialLocked
              ? () => {
                  setLetterOpen(false);
                  onPaywall?.("rewrite_letter");
                }
              : undefined
          }
          onNameSaved={onNameSaved}
          onClose={() => setLetterOpen(false)}
        />
      )}
      {cvOpen && job.cv_url && (
        <CvModal
          company={company}
          title={title}
          cvUrl={job.cv_url}
          fullName={profile?.full_name ?? null}
          onLockedRefine={
            trialLocked
              ? () => {
                  setCvOpen(false);
                  onPaywall?.("rewrite_cv");
                }
              : undefined
          }
          onClose={() => setCvOpen(false)}
        />
      )}
    </article>
  );
}
