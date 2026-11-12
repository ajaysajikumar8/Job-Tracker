import type { NextConfig } from "next";

// Env is loaded by the launcher (scripts/launcher.ts) before Next starts: Next has already cached
// its own loadEnvConfig call for apps/web by the time this file runs, so loading the root here is a no-op.
const config: NextConfig = {
  agentRules: false,
};

export default config;
