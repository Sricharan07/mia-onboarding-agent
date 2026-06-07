import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app.js";
import { registerAppRoutes } from "./apps.js";
import { registerUiMapRoutes } from "./uiMap.js";
import { registerWorkflowRoutes } from "./workflows.js";
import { registerRuntimeRoutes } from "./runtime.js";
import { registerVoiceRoutes } from "./voice.js";
import { registerLogRoutes } from "./logs.js";
import { registerApiKeyHook } from "./auth.js";
import { registerApiKeyRoutes } from "./apiKeys.js";
import { registerMetricRoutes } from "./metrics.js";
import { registerSystemRoutes } from "./system.js";

export async function registerRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  registerApiKeyHook(app, dependencies);

  app.get("/api/v1/health", async () => ({
    ok: true,
    service: "ai-onboarding-backend",
    mode: dependencies.config.NODE_ENV,
    time: new Date().toISOString()
  }));

  await registerSystemRoutes(app, dependencies);
  await registerApiKeyRoutes(app, dependencies);
  await registerMetricRoutes(app, dependencies);
  await registerAppRoutes(app, dependencies);
  await registerUiMapRoutes(app, dependencies);
  await registerWorkflowRoutes(app, dependencies);
  await registerRuntimeRoutes(app, dependencies);
  await registerVoiceRoutes(app, dependencies);
  await registerLogRoutes(app, dependencies);
}
