import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app.js";

export function registerRateLimitHook(app: FastifyInstance, dependencies: AppDependencies): void {
  app.addHook("preHandler", async (request) => {
    dependencies.services.rateLimit.consume(request);
  });
}
