import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app.js";

export async function registerSystemRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/system/readiness", async () => dependencies.services.readiness.check());
}
