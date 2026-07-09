import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyScope } from "./auth.js";

export async function registerPrivacyRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/apps/:appId/data-export", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const { appId } = z.object({ appId: z.string().min(1) }).parse(request.params);
    return dependencies.repositories.exportAppData(appId);
  });

  app.delete("/api/v1/apps/:appId/user-data/:userId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const { appId, userId } = z.object({ appId: z.string().min(1), userId: z.string().min(1) }).parse(request.params);
    return dependencies.repositories.deleteUserData(appId, userId);
  });

  app.post("/api/v1/apps/:appId/data-retention/purge", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const { appId } = z.object({ appId: z.string().min(1) }).parse(request.params);
    return dependencies.repositories.purgeExpiredData(appId);
  });
}
