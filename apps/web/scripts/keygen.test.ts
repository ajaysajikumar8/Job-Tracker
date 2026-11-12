import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keygen } from "./keygen";

let dir: string;
let envFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "keygen-"));
  envFile = join(dir, ".env.local");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const mode = async () => (await stat(envFile)).mode & 0o777;
const keyIn = (content: string) => /^RECOVERY_KEY=([0-9a-f]{64})$/m.exec(content)?.[1];

describe("keygen", () => {
  it("creates the file with a 64-hex key and 0600 permissions", async () => {
    const result = await keygen(envFile);
    const content = await readFile(envFile, "utf8");
    expect(result.status).toBe("written");
    expect(keyIn(content)).toMatch(/^[0-9a-f]{64}$/);
    expect(await mode()).toBe(0o600);
  });

  it("leaves a non-empty key unchanged on a second run", async () => {
    await keygen(envFile);
    const before = await readFile(envFile, "utf8");
    expect(await keygen(envFile)).toEqual({ status: "exists" });
    expect(await readFile(envFile, "utf8")).toBe(before);
  });

  it("fills an empty RECOVERY_KEY= line in place, without duplicating it", async () => {
    await writeFile(envFile, "AI_MODE=none\nRECOVERY_KEY=\nBYOK_MODEL=\n");
    const result = await keygen(envFile);
    const content = await readFile(envFile, "utf8");
    expect(result.status).toBe("written");
    expect(content.match(/RECOVERY_KEY/g)).toHaveLength(1);
    expect(content.split("\n")).toEqual([
      "AI_MODE=none",
      `RECOVERY_KEY=${keyIn(content)}`,
      "BYOK_MODEL=",
      "",
    ]);
  });

  it("treats a quoted empty value as empty", async () => {
    await writeFile(envFile, 'RECOVERY_KEY=""\n');
    expect((await keygen(envFile)).status).toBe("written");
  });

  it("appends when the file has other variables but no key", async () => {
    await writeFile(envFile, "AI_MODE=none");
    await keygen(envFile);
    const content = await readFile(envFile, "utf8");
    expect(content.startsWith("AI_MODE=none\nRECOVERY_KEY=")).toBe(true);
  });

  it("tightens a pre-existing 0644 file to 0600 when it writes", async () => {
    await writeFile(envFile, "RECOVERY_KEY=\n");
    await chmod(envFile, 0o644);
    await keygen(envFile);
    expect(await mode()).toBe(0o600);
  });

  it("never touches a file that already has a key, whatever its permissions", async () => {
    const existing = `RECOVERY_KEY=${"ab".repeat(32)}\n`;
    await writeFile(envFile, existing);
    await keygen(envFile);
    expect(await readFile(envFile, "utf8")).toBe(existing);
  });
});
