import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

const appInputSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  baseUrl: z.string().url()
});

export async function registerAppRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/apps", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["apps:read"])
  }, async (request) => {
    if (request.apiKey?.scopes.includes("admin")) {
      return { items: dependencies.repositories.listApps() };
    }
    requireApiKeyAppAccess(request, dependencies, request.apiKey?.appId ?? undefined);
    return { items: request.apiKey?.appId ? [dependencies.repositories.getApp(request.apiKey.appId)] : [] };
  });

  app.post("/api/v1/apps", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const body = appInputSchema.parse(request.body);
    return dependencies.repositories.upsertApp(body);
  });
}
