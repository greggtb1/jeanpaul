import { useEffect, useState } from "react";
import { APP_VERSION } from "./version";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

type AgentStatus = {
  phase: string;
  message: string;
  runId?: string;
  error?: string;
};

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || "http://localhost:3000";

const STATUS_LABEL: Record<string, string> = {
  idle: "En attente",
  claim: "Connexion",
  running: "En cours",
  error: "Erreur",
};

async function handleToken(token: string, setStatus: (s: AgentStatus) => void) {
  setStatus({ phase: "claim", message: "Connexion au serveur…" });
  try {
    const result = await invoke<{
      runId: string;
      message: string;
      error?: string;
    }>("claim_and_run", { token, apiOrigin: API_ORIGIN });
    if (result.error) {
      setStatus({ phase: "error", message: result.message, error: result.error, runId: result.runId });
      return;
    }
    setStatus({ phase: "running", message: result.message, runId: result.runId });
  } catch (e) {
    setStatus({
      phase: "error",
      message: "Impossible de lancer l'agent.",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function parseTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token");
  } catch {
    return null;
  }
}

export default function App() {
  const [status, setStatus] = useState<AgentStatus>({
    phase: "idle",
    message: "En attente d'une candidature depuis le dashboard…",
  });

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const startUrls = await getCurrent();
        if (!cancelled && startUrls?.length) {
          const token = parseTokenFromUrl(startUrls[0]);
          if (token) await handleToken(token, setStatus);
        }
      } catch {
        /* deep link plugin unavailable in pure web preview */
      }
    }

    void boot();

    const unlistenOpen = onOpenUrl((urls) => {
      const token = urls[0] ? parseTokenFromUrl(urls[0]) : null;
      if (token) void handleToken(token, setStatus);
    });

    const unlistenEvent = listen<string>("agent://status", (event) => {
      setStatus((prev) => ({ ...prev, message: event.payload }));
    });

    return () => {
      cancelled = true;
      void unlistenOpen.then((fn) => fn());
      void unlistenEvent.then((fn) => fn());
    };
  }, []);

  return (
    <main className="agent">
      <header className="agent__header">
        <div className="agent__brand">
          <span className="agent__logo" aria-hidden>
            <span className="agent__logo-bar agent__logo-bar--blue" />
            <span className="agent__logo-bar agent__logo-bar--coral" />
            <span className="agent__logo-bar agent__logo-bar--yellow" />
          </span>
          <span className="agent__wordmark">
            JEAN PAUL <b>Agent</b>
          </span>
        </div>
        <p className="agent__tagline">
          Postulez en local, Chromium s&apos;ouvre sur votre machine
        </p>
      </header>

      <section className={`agent__card agent__card--${status.phase}`}>
        <span className={`agent__pill agent__pill--${status.phase}`}>
          <span className="agent__dot" />
          {STATUS_LABEL[status.phase] ?? status.phase}
        </span>
        <p className="agent__message">{status.message}</p>
        {status.runId && (
          <p className="agent__run">Run {status.runId.slice(0, 8)}</p>
        )}
        {status.error && <p className="agent__error">{status.error}</p>}
      </section>

      <ol className="agent__steps">
        <li>
          <span className="agent__step-num">1</span>
          <span>
            Sélectionnez des offres sur{" "}
            <a href={API_ORIGIN} target="_blank" rel="noreferrer">
              le dashboard
            </a>
          </span>
        </li>
        <li>
          <span className="agent__step-num">2</span>
          <span>
            Cliquez Postuler. Chromium se télécharge tout seul si besoin (~1 min), puis
            s&apos;ouvre sur votre écran
          </span>
        </li>
      </ol>

      <p className="agent__chromium-note">
        Rien à installer de plus : l&apos;agent gère Chromium pour vous.
      </p>

      <footer className="agent__footer">
        <p>
          La progression s&apos;affiche aussi sur{" "}
          <a href={`${API_ORIGIN}/dashboard`} target="_blank" rel="noreferrer">
            le dashboard
          </a>
          .
        </p>
        <span className="agent__version">v{APP_VERSION}</span>
      </footer>
    </main>
  );
}
