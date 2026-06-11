"use client";
import { useEffect, useRef, useState } from "react";
import { tasks as tasksApi, type Task } from "@/lib/api";

export default function TaskLog({ task, onDone }: { task: Task; onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = tasksApi.streamUrl(task.id);
    const es = new EventSource(url);

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.log) setLines((l) => [...l, data.log]);
      if (data.progress != null) setProgress(data.progress);
    };

    es.addEventListener("done", (e: any) => {
      const data = JSON.parse(e.data);
      setDone(true);
      es.close();
      setTimeout(onDone, 1500);
    });

    es.onerror = () => es.close();

    return () => es.close();
  }, [task.id]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="card border-indigo-500/30">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {!done ? (
            <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
          ) : (
            <span className="w-2 h-2 bg-green-400 rounded-full" />
          )}
          <span className="text-sm font-medium">
            {done ? "✅ Terminé" : `Pipeline en cours… ${progress}%`}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/[0.05] rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Logs */}
      <div className="font-mono text-xs text-gray-400 bg-black/30 rounded-lg p-4 h-48 overflow-y-auto">
        {lines.map((line, i) => (
          <div key={i} className="leading-5">{line}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
