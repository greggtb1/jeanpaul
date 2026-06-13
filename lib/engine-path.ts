import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

export type EnginePaths = {
  engineDir: string;
  script: string;
  python: string | null;
  scriptOk: boolean;
};

function resolveBinary(candidate: string): string | null {
  if (!candidate) return null;
  if (candidate.includes("/")) {
    return existsSync(candidate) ? candidate : null;
  }
  try {
    const resolved = execSync(`command -v ${candidate}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return resolved || null;
  } catch {
    return null;
  }
}

function pushEngineDir(candidates: string[], seen: Set<string>, dir: string) {
  const norm = path.resolve(dir);
  if (seen.has(norm)) return;
  seen.add(norm);
  candidates.push(norm);
}

function discoverEngine(cwd: string): { engineDir: string; script: string } {
  const candidates: string[] = [];
  const seen = new Set<string>();

  if (process.env.ENGINE_DIR?.trim()) {
    pushEngineDir(candidates, seen, process.env.ENGINE_DIR.trim());
  }

  const appRoot = process.env.APP_ROOT?.trim();
  if (appRoot) {
    pushEngineDir(candidates, seen, path.join(appRoot, "engine"));
  }

  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    pushEngineDir(candidates, seen, path.join(dir, "engine"));
    pushEngineDir(candidates, seen, path.join(dir, ".builds", "last-source", "engine"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const home = process.env.HOME?.trim();
  if (home) {
    pushEngineDir(candidates, seen, path.join(home, "jeanpaul", "engine"));
  }

  for (const engineDir of candidates) {
    const script = path.join(engineDir, "run_for_user.py");
    if (existsSync(script)) {
      return { engineDir, script };
    }
  }

  const fallbackDir = path.join(cwd, "engine");
  return {
    engineDir: fallbackDir,
    script: path.join(fallbackDir, "run_for_user.py"),
  };
}

export function resolveEnginePaths(cwd = process.cwd()): EnginePaths {
  const { engineDir, script } = discoverEngine(cwd);

  const candidates = [
    process.env.ENGINE_PYTHON?.trim(),
    path.join(engineDir, "venv", "bin", "python"),
    path.join(engineDir, "venv", "bin", "python3"),
    "python3",
    "python",
  ].filter((c): c is string => !!c);

  let python: string | null = null;
  for (const candidate of candidates) {
    const resolved = resolveBinary(candidate);
    if (resolved) {
      python = resolved;
      break;
    }
  }

  return {
    engineDir,
    script,
    python,
    scriptOk: existsSync(script),
  };
}

export function engineUnavailableMessage(paths: EnginePaths): string {
  if (!paths.scriptOk) {
    return "Déploiement incomplet : le dossier engine/ est absent sur le serveur.";
  }
  if (!paths.python) {
    return "Python indisponible sur le serveur. Exécutez scripts/setup-engine-prod.sh via SSH.";
  }
  return "Moteur de recherche indisponible. Réessayez plus tard.";
}
