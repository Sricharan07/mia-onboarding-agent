import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

export async function registerSemanticIndexRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/apps/:appId/semantic-index/rebuild", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    requireApiKeyAppAccess(request, dependencies, params.appId);
    return dependencies.services.semanticIndex.rebuildApp(params.appId);
  });
}
