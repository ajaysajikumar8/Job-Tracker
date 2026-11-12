import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvError } from "../src/env";
import { launch, type ProcessSpec } from "./launcher";

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "launcher-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const node = (name: string, code: string, ...args: string[]): ProcessSpec => ({
  name,
  command: process.execPath,
  args: ["-e", code, ...args],
});

/** Records its pid, then runs until killed. */
const sleeper = (pidFile: string) =>
  node(
    "sleeper",
    "require('fs').appendFileSync(process.argv[1], process.pid + '\\n'); setInterval(() => {}, 1000)",
    pidFile,
  );

const exitsWith = (code: number) => node("exiter", `process.exit(${code})`);

/** Exits 75 once (marker file), then runs until killed: a staged restore followed by a normal run. */
const restartsOnce = (marker: string) =>
  node(
    "restarter",
    "const fs = require('fs'); if (!fs.existsSync(process.argv[1])) { fs.writeFileSync(process.argv[1], 'x'); process.exit(75) } setInterval(() => {}, 1000)",
    marker,
  );

const pidsIn = (file: string) =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map(Number) : [];

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("launch", () => {
  it("restarts everything on exit 75: stops the sibling and runs bootstrap again", async () => {
    const pidFile = join(dir, "pids");
    const controller = new AbortController();
    let calls = 0;
    const bootstrap = vi.fn(async () => {
      calls += 1;
      if (calls === 2) setTimeout(() => controller.abort(), 1500);
    });

    const code = await launch({
      bootstrap,
      signal: controller.signal,
      processes: [restartsOnce(join(dir, "marker")), sleeper(pidFile)],
      graceMs: 2000,
    });

    expect(code).toBe(0);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(pidsIn(pidFile).length).toBeGreaterThan(0);
    expect(pidsIn(pidFile).some(isAlive)).toBe(false);
  });

  it("stops the sibling and returns the exit code when a process crashes", async () => {
    const pidFile = join(dir, "pids");
    const code = await launch({
      bootstrap: async () => {},
      signal: new AbortController().signal,
      processes: [sleeper(pidFile), exitsWith(3)],
      graceMs: 2000,
    });
    expect(code).toBe(3);
    expect(pidsIn(pidFile).some(isAlive)).toBe(false);
  });

  it("stops everything and returns 0 when aborted (Ctrl-C)", async () => {
    const pidFile = join(dir, "pids");
    const controller = new AbortController();
    const abortWhenBothStarted = setInterval(() => {
      if (pidsIn(pidFile).length === 2) {
        clearInterval(abortWhenBothStarted);
        controller.abort();
      }
    }, 50);
    const code = await launch({
      bootstrap: async () => {},
      signal: controller.signal,
      processes: [sleeper(pidFile), sleeper(pidFile)],
      graceMs: 2000,
    });
    expect(code).toBe(0);
    expect(pidsIn(pidFile).length).toBe(2);
    expect(pidsIn(pidFile).some(isAlive)).toBe(false);
  });

  it("gives up when a process keeps requesting restarts", async () => {
    const bootstrap = vi.fn(async () => {});
    const code = await launch({
      bootstrap,
      signal: new AbortController().signal,
      processes: [exitsWith(75)],
      maxQuickRestarts: 2,
      graceMs: 2000,
    });
    expect(code).toBe(1);
    expect(bootstrap).toHaveBeenCalledTimes(3);
  });

  it("starts nothing when bootstrap fails", async () => {
    const marker = join(dir, "started");
    const code = await launch({
      bootstrap: async () => {
        throw new EnvError("Invalid environment configuration");
      },
      signal: new AbortController().signal,
      processes: [node("p", "require('fs').writeFileSync(process.argv[1], 'x')", marker)],
    });
    expect(code).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("launcher CLI", () => {
  it("refuses to start with a malformed key and never prints it", () => {
    const bad = `${"ab".repeat(31)}zz`;
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/launcher.ts", "dev"], {
      cwd: WEB_DIR,
      encoding: "utf8",
      env: { ...process.env, RECOVERY_KEY: bad, DEMO_MODE: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm keygen");
    expect(result.stdout + result.stderr).not.toContain(bad);
  });
});
