import { spawn, type ChildProcess } from "child_process";
import { closeSync, mkdirSync, openSync } from "fs";
import path from "path";
import type { EnginePaths } from "@/lib/engine-path";

export function engineRunLogPath(engineDir: string, runId: string): string {
  return path.join(engineDir, "run-logs", `${runId}.log`);
}

/** Lance le moteur Python en arrière-plan ; stderr/stdout → run-logs/{runId}.log */
export function spawnEngineProcess(
  engine: EnginePaths,
  runId: string,
  args: string[],
  env: NodeJS.ProcessEnv
): ChildProcess {
  const logDir = path.join(engine.engineDir, "run-logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = engineRunLogPath(engine.engineDir, runId);
  const fd = openSync(logPath, "a");

  const child = spawn(engine.python!, [engine.script, ...args], {
    cwd: engine.engineDir,
    detached: true,
    stdio: ["ignore", fd, fd],
    env,
  });

  closeSync(fd);
  return child;
}
