import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findRepoRoot } from "../src/repo-root";

const KEY_LINE = /^\s*(?:export\s+)?RECOVERY_KEY\s*=(.*)$/;

export type KeygenResult = { status: "exists" } | { status: "written"; key: string };

const isSet = (rawValue: string) => rawValue.trim().replace(/^(['"])(.*)\1$/, "$2") !== "";

/** Writes RECOVERY_KEY into `envFile` only when absent or empty. Never overwrites a non-empty key. */
export async function keygen(envFile: string): Promise<KeygenResult> {
  const content = await readFile(envFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const lines = content === "" ? [] : content.replace(/\r?\n$/, "").split(/\r?\n/);

  let lastKeyLine = -1;
  for (const [index, line] of lines.entries()) {
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    if (isSet(match[1] ?? "")) return { status: "exists" };
    lastKeyLine = index;
  }

  const key = randomBytes(32).toString("hex");
  if (lastKeyLine >= 0) lines[lastKeyLine] = `RECOVERY_KEY=${key}`;
  else lines.push(`RECOVERY_KEY=${key}`);

  const tmp = `${envFile}.tmp`;
  await writeFile(tmp, `${lines.join("\n")}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, envFile);
  return { status: "written", key };
}

async function main() {
  const envFile = join(findRepoRoot(), ".env.local");
  const result = await keygen(envFile);
  if (result.status === "exists") {
    console.log("RECOVERY_KEY is already set in .env.local. Left unchanged.");
    return;
  }
  console.log(`RECOVERY_KEY written to .env.local (permissions 0600).

  ${result.key}

SAVE THIS NOW in a password manager, outside this machine. It encrypts your
database and every backup. If it is lost, your data and backups are unrecoverable.
It is shown only once.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
