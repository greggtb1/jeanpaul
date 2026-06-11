"use client";
import { useEffect, useState } from "react";
import { jobs as jobsApi, tasks as tasksApi, type Job, type Task } from "@/lib/api";
import JobCard from "@/components/JobCard";
import TaskLog from "@/components/TaskLog";
import Sidebar from "@/components/Sidebar";

const STATUS_TABS = ["Tous", "Nouveau", "Analysé", "Généré", "Rempli", "Soumis"];

export default function Dashboard() {
  const [jobList, setJobList]     = useState<Job[]>([]);
  const [stats, setStats]         = useState<any>(null);
  const [activeTab, setActiveTab] = useState("Tous");
  const [minScore, setMinScore]   = useState(0);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [loading, setLoading]     = useState(true);
  const [running, setRunning]     = useState(false);

  const STATUS_MAP: Record<string, string> = {
    "Nouveau": "new", "Analysé": "analyzed", "Généré": "generated",
    "Rempli": "filled", "Soumis": "submitted",
  };

  async function load() {
    setLoading(true);
    try {
      const [j, s] = await Promise.all([
        jobsApi.list({
          status: activeTab === "Tous" ? undefined : STATUS_MAP[activeTab],
          min_score: minScore,
          limit: 100,
        }),
        jobsApi.stats(),
      ]);
      setJobList(j);
      setStats(s);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [activeTab, minScore]);

  async function runPipeline() {
    setRunning(true);
    try {
      const { task_id } = await jobsApi.pipeline({
        platforms: ["linkedin", "wttj"],
        min_score: 6,
        max_per_query: 10,
      });
      const t = await tasksApi.get(task_id);
      setActiveTask(t);
    } catch (e: any) {
      alert(e.message);
    }
    setRunning(false);
  }

  function onTaskDone() {
    setActiveTask(null);
    load();
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <button
            onClick={runPipeline}
            disabled={running}
            className="btn-primary flex items-center gap-2"
          >
            {running ? (
              <><span className="animate-spin">⟳</span> En cours...</>
            ) : (
              <>⚡ Lancer la routine</>
            )}
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: "Total offres", value: stats.total, color: "text-white" },
              { label: "Générées", value: stats.generated, color: "text-indigo-400" },
              { label: "Soumises", value: stats.submitted, color: "text-green-400" },
              { label: "Entretiens", value: stats.interview, color: "text-yellow-400" },
            ].map((s) => (
              <div key={s.label} className="card text-center">
                <div className={`text-3xl font-bold mb-1 ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Task log en cours */}
        {activeTask && (
          <div className="mb-6">
            <TaskLog task={activeTask} onDone={onTaskDone} />
          </div>
        )}

        {/* Filtres */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex bg-white/[0.03] border border-white/[0.06] rounded-lg p-1 gap-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="bg-white/[0.03] border border-white/[0.06] text-sm text-gray-300 rounded-lg px-3 py-2"
          >
            <option value={0}>Tous les scores</option>
            <option value={6}>≥ 6/10</option>
            <option value={7}>≥ 7/10</option>
            <option value={8}>≥ 8/10</option>
          </select>
          <span className="text-sm text-gray-500 ml-auto">{jobList.length} offre(s)</span>
        </div>

        {/* Liste des offres */}
        {loading ? (
          <div className="text-center text-gray-500 py-20">Chargement...</div>
        ) : jobList.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">📭</div>
            <div className="text-gray-400 mb-2">Aucune offre pour ces filtres.</div>
            <button onClick={runPipeline} className="btn-primary mt-4">Lancer un scraping</button>
          </div>
        ) : (
          <div className="space-y-3">
            {jobList.map((job) => (
              <JobCard key={job.id} job={job} onUpdate={load} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
