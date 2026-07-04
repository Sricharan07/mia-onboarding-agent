import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

const usageQuerySchema = z.object({
  appId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  bucket: z.literal("day").optional()
});

export async function registerMetricRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/metrics/usage", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["logs:read"])
  }, async (request) => {
    const query = usageQuerySchema.omit({ bucket: true }).parse(request.query);
    requireApiKeyAppAccess(request, dependencies, query.appId);
    return dependencies.services.usage.summary(query);
  });

  app.get("/api/v1/metrics/usage/timeseries", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["logs:read"])
  }, async (request) => {
    const query = usageQuerySchema.parse(request.query);
    requireApiKeyAppAccess(request, dependencies, query.appId);
    return { items: dependencies.services.usage.timeseries(query) };
  });
}
