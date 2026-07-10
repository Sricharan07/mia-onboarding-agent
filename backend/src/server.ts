import { buildApp } from "./app.js";
import { loadV1Config } from "./v1/config.js";

const config = loadV1Config();
const app = await buildApp(config);
let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Graceful shutdown started");
  const deadline = setTimeout(() => {
    app.log.fatal({ signal }, "Graceful shutdown deadline exceeded");
    process.exit(1);
  }, config.SHUTDOWN_GRACE_PERIOD_MS ?? 30_000);
  deadline.unref();

  try {
    await app.close();
    clearTimeout(deadline);
    app.log.info({ signal }, "Graceful shutdown completed");
  } catch (error) {
    clearTimeout(deadline);
    app.log.error(error, "Graceful shutdown failed");
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.BACKEND_HOST, port: config.BACKEND_PORT });
} catch (error) {
  app.log.error(error);
  await app.close().catch(() => undefined);
  process.exitCode = 1;
}
