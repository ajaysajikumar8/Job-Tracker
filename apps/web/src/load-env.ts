import nextEnv from "@next/env";
import { type Env, EnvError, parseEnv } from "./env";
import { findRepoRoot } from "./repo-root";

// @next/env is CommonJS: Node ESM (tsx) cannot see its named exports, so destructure the default.
const { loadEnvConfig } = nextEnv;

/**
 * For Node entry points run by tsx (launcher, bootstrap, worker): loads the repo-root `.env.local`
 * (ADR 0009), then validates. Process env wins over the file. The web app never calls this; the
 * launcher starts it with the environment already loaded, and it uses `parseEnv(process.env)`.
 */
export function loadEnv(): Env {
  loadEnvConfig(findRepoRoot(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  return parseEnv(process.env);
}

export function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
