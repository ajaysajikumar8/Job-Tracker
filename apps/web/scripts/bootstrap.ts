import { loadEnv } from "../src/load-env";

/** Runs before web and worker start. M1: env validation only; M2 adds restore swap, migrations, seeding. */
export async function bootstrap(): Promise<void> {
  loadEnv();
}
