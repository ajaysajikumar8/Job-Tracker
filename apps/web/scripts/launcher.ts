import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EnvError } from "../src/env";
import { bootstrap } from "./bootstrap";

/** A staged restore (ADR 0008) exits with this code to ask for a clean restart. */
const RESTART_EXIT_CODE = 75;

export interface ProcessSpec {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
}

export interface LaunchOptions {
  bootstrap: () => Promise<void>;
  processes: ProcessSpec[];
  signal: AbortSignal;
  /** Restarts allowed in a row when the previous run lasted less than `quickRestartMs`. */
  maxQuickRestarts?: number;
  quickRestartMs?: number;
  graceMs?: number;
}

interface Running {
  spec: ProcessSpec;
  proc: ChildProcess;
  exited: Promise<number>;
}

const log = (message: string) => console.log(`[launcher] ${message}`);

function startProcess(spec: ProcessSpec): Running {
  // Own process group, so Ctrl-C reaches only the launcher and it can stop each tree itself.
  const proc = spawn(spec.command, spec.args, { cwd: spec.cwd, stdio: "inherit", detached: true });
  const exited = new Promise<number>((resolve) => {
    proc.once("error", (error) => {
      console.error(`[launcher] could not start ${spec.name}: ${error.message}`);
      resolve(1);
    });
    proc.once("exit", (code) => resolve(code ?? 1));
  });
  return { spec, proc, exited };
}

function signalGroup(running: Running, signal: NodeJS.Signals) {
  if (running.proc.pid === undefined) return;
  try {
    process.kill(-running.proc.pid, signal);
  } catch {
    // Already gone.
  }
}

async function stopAll(all: Running[], graceMs: number) {
  for (const running of all) signalGroup(running, "SIGTERM");
  const everyoneExited = Promise.all(all.map((running) => running.exited));
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), graceMs);
  });
  if ((await Promise.race([everyoneExited, timedOut])) === "timeout") {
    for (const running of all) signalGroup(running, "SIGKILL");
    await everyoneExited;
  }
  clearTimeout(timer);
}

/** Runs bootstrap, then all processes together. Resolves with the launcher's exit code. */
export async function launch(options: LaunchOptions): Promise<number> {
  const { maxQuickRestarts = 3, quickRestartMs = 30_000, graceMs = 10_000 } = options;
  let quickRestarts = 0;

  for (;;) {
    if (options.signal.aborted) return 0;

    try {
      await options.bootstrap();
    } catch (error) {
      console.error(
        error instanceof EnvError ? error.message : `[launcher] bootstrap failed: ${String(error)}`,
      );
      return 1;
    }
    if (options.signal.aborted) return 0;

    const startedAt = Date.now();
    const running = options.processes.map(startProcess);
    const aborted = new Promise<"abort">((resolve) =>
      options.signal.addEventListener("abort", () => resolve("abort"), { once: true }),
    );
    const first = await Promise.race([
      aborted,
      ...running.map((r) => r.exited.then((code) => ({ name: r.spec.name, code }))),
    ]);
    await stopAll(running, graceMs);

    if (first === "abort") return 0;

    if (first.code !== RESTART_EXIT_CODE) {
      log(`${first.name} exited with code ${first.code}; stopped everything.`);
      return first.code;
    }

    quickRestarts = Date.now() - startedAt < quickRestartMs ? quickRestarts + 1 : 0;
    if (quickRestarts > maxQuickRestarts) {
      log(`${first.name} keeps requesting restarts; giving up.`);
      return 1;
    }
    log(`${first.name} requested a restart (exit ${RESTART_EXIT_CODE}); running bootstrap again.`);
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "dev" && mode !== "start") {
    console.error("Usage: launcher.ts <dev|start>");
    process.exit(2);
  }

  const require = createRequire(import.meta.url);
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => controller.abort());
  }

  const code = await launch({
    bootstrap,
    signal: controller.signal,
    processes: [
      {
        name: "web",
        command: process.execPath,
        // 127.0.0.1 only: the app must not be reachable from another machine (ADR 0003).
        args: [require.resolve("next/dist/bin/next"), mode, "-H", "127.0.0.1"],
        cwd,
      },
      {
        name: "worker",
        command: process.execPath,
        args: ["--import", "tsx", "src/worker.ts"],
        cwd,
      },
    ],
  });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
