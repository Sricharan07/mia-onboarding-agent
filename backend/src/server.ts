import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.listen({ host: config.BACKEND_HOST, port: config.BACKEND_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
