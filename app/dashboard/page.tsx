"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { type Profile, type Job } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import PipelineLog, { type PipelineRun } from "@/components/PipelineLog";
import PipelineProgress from "@/components/PipelineProgress";
import { parsePipelinePhase, isAutoapplyRun } from "@/lib/pipeline-phase";
import LetterModal from "@/components/LetterModal";
import AutoApplyTuto from "@/components/AutoApplyTuto";
import DashboardOnboarding from "@/components/DashboardOnboarding";
import DashboardGuide from "@/components/DashboardGuide";
import { parseApiJson } from "@/lib/parse-api-json";

const TABS = [
  { id: "all", label: "Toutes" },
  { id: "applied", label: "Candidatures envoyées" },
  { id: "generated", label: "Candidatures à envoyer" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function TabFilterButton({ tab, onChange }: { tab: TabId; onChange: (id: TabId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = TABS.find((t) => t.id === tab)!;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="db__filter-btn-wrap" ref={ref}>
      <button
        type="button"
        className={`db__filter-btn${tab !== "all" ? " db__filter-btn--active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="db__filter-btn-icon" aria-hidden="true">⊟</span>
        <span>{tab === "all" ? "Filtrer" : current.label}</span>
        <span className="db__filter-btn-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul className="db__filter-dropdown" role="listbox">
          {TABS.map((t) => (
            <li
              key={t.id}
              role="option"
              aria-selected={tab === t.id}
              className={`db__filter-option${tab === t.id ? " db__filter-option--active" : ""}`}
              onClick={() => { onChange(t.id); setOpen(false); }}
            >
              {tab === t.id && <span className="db__filter-check" aria-hidden="true">✓</span>}
              {t.label}
            </li>
          ))}
        </ul>
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
  const s = getJobScore(job);
  if (s === null) return true;
  return s >= 6;
}

function sortByScore(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => (getJobScore(b) ?? -1) - (getJobScore(a) ?? -1));
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
  const [sideTab, setSideTab] = useState<"terminal" | "guide">("terminal");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const [{ data: prof }, { data: js }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("jobs")
        .select("url,data,fit_score,applied,deleted,cv_url,letter_url,user_id,created_at,updated_at")
        .eq("user_id", id)
        .eq("deleted", false)
        .order("created_at", { ascending: false }),
    ]);
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
      const data = await parseApiJson<{ error?: string; alreadyRunning?: boolean }>(res);
      if (!res.ok || data.error) throw new Error(data.error || `Erreur ${res.status}`);
      if (mode === "autoapply") {
        setSelectMode(false);
        setSelectedUrls(new Set());
        setShowAutoTuto(false);
      }
      if (mode === "full" && !data.alreadyRunning && uid) {
        await supabase
          .from("profiles")
          .update({
            first_search_done: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", uid);
        setProfile((p) => (p ? { ...p, first_search_done: true } : p));
      }
      await fetchRun();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLaunching(false);
    }
  }, [fetchRun, uid, supabase]);

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
          ? "Impossible de marquer la candidature comme envoyée."
          : "Impossible de décocher la candidature."
      );
    }
  }, [uid, supabase]);

  const filtered = jobs.filter((j) => {
    if (tab === "generated") return !!j.cv_url && !j.applied;
    if (tab === "applied") return !!j.applied;
    return true;
  });

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
      ready: jobs.filter((j) => j.cv_url).length,
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
            </p>
          )}
        </div>

        <div className={`db-page-split${showFirstSearch ? " db-page-split--first" : ""}`}>
          <div className="db-page-main">
        {showFirstSearch && (
          <section className="db__hero-first" aria-labelledby="first-search-title">
            <div className="db__hero-first-glow" aria-hidden="true" />
            <span className="db__hero-first-badge">Première étape</span>
            <div className="db__hero-first-icon" aria-hidden="true">🛰️</div>
            <h2 id="first-search-title" className="db__hero-first-title">
              Lancez votre première recherche
            </h2>
            <p className="db__hero-first-lead">
              JEAN PAUL va scanner LinkedIn selon votre profil, scorer chaque offre et préparer vos candidatures.
            </p>
            <ul className="db__hero-first-steps">
              <li>Scan LinkedIn selon vos critères</li>
              <li>Note /10 pour chaque offre</li>
              <li>CV + lettre générés automatiquement</li>
            </ul>
            <button
              type="button"
              className="btn btn--hero db__hero-first-cta"
              disabled={launching}
              onClick={() => uid && startPipeline()}
            >
              {launching ? "Lancement en cours…" : "Lancer la recherche"}
            </button>
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
            {pendingAnalysis > 0 && (
              <AnalyzePendingCta
                count={pendingAnalysis}
                launching={launching}
                onAnalyze={() => startPipeline("analyze")}
              />
            )}
            <DashboardActionsBar
              launching={launching}
              onSearch={() => startPipeline()}
              showApply={autoApplyEligible.length > 0}
              applyCount={autoApplyEligible.length}
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
              <div className="db__stats-inline">
                <span className="db__stat-chip">{stats.total} offres</span>
                {stats.ready > 0 && <span className="db__stat-chip">{stats.ready} à envoyer</span>}
                {stats.applied > 0 && <span className="db__stat-chip db__stat-chip--green">{stats.applied} envoyée{stats.applied > 1 ? "s" : ""}</span>}
              </div>
            )}
          </div>
          {!selectMode && (
          <TabFilterButton
            tab={tab}
            onChange={(id) => setTab(id)}
          />
          )}
        </div>

        {loading || authLoading ? (
          <div className="db__empty">Chargement…</div>
        ) : filtered.length === 0 && pipelineActive ? null
        : pipelineActive ? (
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
      <DashboardOnboarding />
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
  showApply,
  applyCount,
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
  showApply?: boolean;
  applyCount?: number;
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

  return (
    <div className="db-acts-wrap">
      <div className="db-acts-btns">
        <button
          type="button"
          className="db-big-btn"
          disabled={launching || selectMode}
          onClick={onSearch}
        >
          {launching ? "Lancement…" : "Scanner"}
        </button>
        {showApply && onStartApply && (
          <div className={`db-big-btn-group${selectMode ? " db-big-btn-group--active" : ""}`}>
            <button
              type="button"
              className="db-big-btn db-big-btn--apply"
              disabled={selectMode}
              onClick={onStartApply}
            >
              Postuler{applyCount ? ` (${applyCount})` : ""}
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
        )}
      </div>

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
          Reprenez là où vous vous êtes arrêté : scoring et candidatures, sans relancer LinkedIn.
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

  const rowSelectProps = (j: Job) => ({
    selectMode,
    selectable: isAutoApplyEligible(j),
    selected: selectedUrls?.has(j.url) ?? false,
    onToggleSelect: onToggleSelect ? () => onToggleSelect(j.url) : undefined,
  });

  if (pipelineActive) {
    return (
      <div className="db__list db__list--live">
        {jobs.map((j, i) => (
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

  const { priority, low } = splitJobs(jobs);

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
  const fitReasoning = getJobFitReasoning(job);
  const canExpandDetail = !!fitReasoning && !analyzing;

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
        {!compact && job.cv_url && (
          <a className="jr__doc jr__doc--cv" href={job.cv_url} target="_blank" rel="noopener">
            CV
          </a>
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
        {!compact && job.cv_url && onToggleApplied && (
          <button
            type="button"
            className={`jr__mark ${job.applied ? "jr__mark--done" : ""}`}
            onClick={handleToggleApplied}
            title={job.applied ? "Marquer comme non envoyée" : "Marquer comme envoyée"}
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
