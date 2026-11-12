import { z } from "zod";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema);

const baseSchema = z.object({
  DEMO_MODE: optional(z.enum(["0", "1"]).optional()),
  AI_MODE: optional(z.enum(["none", "ollama", "byok"]).default("none")),
  OLLAMA_BASE_URL: optional(z.url().default("http://localhost:11434/v1")),
  EMBEDDING_MODEL: optional(z.string().default("nomic-embed-text")),
  EXTRACTION_MODEL: optional(z.string().default("llama3.2:3b")),
  BYOK_BASE_URL: optional(z.url().optional()),
  BYOK_API_KEY: optional(z.string().optional()),
  BYOK_MODEL: optional(z.string().optional()),
});

type Base = Omit<z.output<typeof baseSchema>, "DEMO_MODE">;
export type Env = Base &
  ({ DEMO_MODE: true; RECOVERY_KEY?: undefined } | { DEMO_MODE: false; RECOVERY_KEY: string });

const KEY_PATTERN = /^[0-9a-f]{64}$/i;

export class EnvError extends Error {
  override name = "EnvError";
}

/**
 * Validates a plain object. Messages are built from issue paths and fixed text only,
 * never from input values, so RECOVERY_KEY cannot leak into an error.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const problems: string[] = [];
  const demo = source.DEMO_MODE === "1";

  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join(".") || "(env)"}: ${issue.message}`);
    }
  }

  const rawKey = source.RECOVERY_KEY;
  if (!demo) {
    if (!rawKey) {
      problems.push("RECOVERY_KEY: missing");
    } else if (!KEY_PATTERN.test(rawKey)) {
      problems.push("RECOVERY_KEY: must be exactly 64 hex characters (32 bytes)");
    }
  }

  if (problems.length > 0 || !parsed.success) {
    const needsKeyHelp = problems.some((p) => p.startsWith("RECOVERY_KEY"));
    throw new EnvError(
      [
        "Invalid environment configuration:",
        ...problems.map((p) => `  - ${p}`),
        ...(needsKeyHelp
          ? ["", "Generate a recovery key with: pnpm keygen  (or: openssl rand -hex 32)"]
          : []),
      ].join("\n"),
    );
  }

  const { DEMO_MODE: _demo, ...rest } = parsed.data;
  return demo
    ? { ...rest, DEMO_MODE: true }
    : { ...rest, DEMO_MODE: false, RECOVERY_KEY: rawKey as string };
}
