import { loadEnvOrExit } from "./load-env";

loadEnvOrExit();
console.log("[worker] stub running (the task loop arrives in M3)");

const keepAlive = setInterval(() => {}, 2 ** 30);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(keepAlive);
    process.exit(0);
  });
}
