import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvError, parseEnv } from "./env";
import { loadEnvOrExit } from "./load-env";

const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("parseEnv", () => {
  it("accepts a valid key and fills AI defaults", () => {
    const env = parseEnv({ RECOVERY_KEY: KEY });
    expect(env).toMatchObject({
      DEMO_MODE: false,
      RECOVERY_KEY: KEY,
      AI_MODE: "none",
      OLLAMA_BASE_URL: "http://localhost:11434/v1",
      EMBEDDING_MODEL: "nomic-embed-text",
      EXTRACTION_MODEL: "llama3.2:3b",
    });
  });

  it("fails on a missing or empty key and names the generator command", () => {
    for (const source of [{}, { RECOVERY_KEY: "" }]) {
      expect(() => parseEnv(source)).toThrow(EnvError);
      expect(() => parseEnv(source)).toThrow(/pnpm keygen/);
    }
  });

  it("rejects malformed keys without echoing them", () => {
    const malformed = [KEY.slice(1), `${KEY}0`, `${KEY.slice(0, 63)}g`];
    for (const bad of malformed) {
      const error = (() => {
        try {
          parseEnv({ RECOVERY_KEY: bad });
        } catch (e) {
          return e as Error;
        }
      })();
      expect(error).toBeInstanceOf(EnvError);
      expect(error?.message).not.toContain(bad);
      expect(error?.message).not.toContain(bad.slice(0, 32));
    }
  });

  it("does not require or read the key under DEMO_MODE=1", () => {
    expect(parseEnv({ DEMO_MODE: "1" })).toMatchObject({ DEMO_MODE: true });
    const withBadKey = parseEnv({ DEMO_MODE: "1", RECOVERY_KEY: "not-a-key" });
    expect(withBadKey.RECOVERY_KEY).toBeUndefined();
  });

  it("fails fast on an invalid AI_MODE without leaking the key", () => {
    const run = () => parseEnv({ RECOVERY_KEY: KEY, AI_MODE: "bogus" });
    expect(run).toThrow(/AI_MODE/);
    expect(run).not.toThrow(KEY);
  });

  it("treats empty optional values as unset (.env.example copy)", () => {
    const env = parseEnv({
      RECOVERY_KEY: KEY,
      AI_MODE: "",
      BYOK_BASE_URL: "",
      BYOK_API_KEY: "",
      BYOK_MODEL: "",
      OLLAMA_BASE_URL: "",
    });
    expect(env.AI_MODE).toBe("none");
    expect(env.BYOK_BASE_URL).toBeUndefined();
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:11434/v1");
  });

  it("still validates non-empty URLs", () => {
    expect(() => parseEnv({ RECOVERY_KEY: KEY, BYOK_BASE_URL: "nope" })).toThrow(/BYOK_BASE_URL/);
  });

  it("never logs", () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    parseEnv({ RECOVERY_KEY: KEY });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("loadEnvOrExit", () => {
  it("prints a readable error and exits 1 without printing the key", () => {
    const bad = `${KEY.slice(0, 63)}z`;
    vi.stubEnv("RECOVERY_KEY", bad);
    vi.stubEnv("DEMO_MODE", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    expect(() => loadEnvOrExit()).toThrow("exit");

    const output = error.mock.calls.flat().join("\n");
    expect(output).toContain("RECOVERY_KEY");
    expect(output).toContain("pnpm keygen");
    expect(output).not.toContain(bad);
  });
});
