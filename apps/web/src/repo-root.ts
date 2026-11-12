import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walks up from `start` to the directory holding `pnpm-workspace.yaml`. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Repo root (pnpm-workspace.yaml) not found above ${start}`);
    }
    dir = parent;
  }
}
