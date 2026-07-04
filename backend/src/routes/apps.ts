import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

const appInputSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  baseUrl: z.string().url(),
  uiScanConfig: z.object({
    routes: z.array(z.string().trim().min(1)).optional(),
    authMode: z.enum(["none", "login_form", "manual"]).optional(),
    loginUrl: z.string().trim().optional(),
    username: z.string().trim().optional(),
    password: z.string().optional(),
    clearPassword: z.boolean().optional(),
    usernameSelector: z.string().trim().optional(),
    passwordSelector: z.string().trim().optional(),
    submitSelector: z.string().trim().optional(),
    successUrlPattern: z.string().trim().optional(),
    postLoginWaitMs: z.number().int().nonnegative().optional(),
    ignoredSelectors: z.array(z.string().trim().min(1)).optional(),
    redactedSelectors: z.array(z.string().trim().min(1)).optional(),
    routeDiscovery: z.object({
      enabled: z.boolean(),
      maxRoutes: z.number().int().positive().max(200)
    }).optional()
  }).optional()
});

export async function registerAppRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/apps", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["apps:read"])
  }, async (request) => {
    if (request.consoleSession?.role === "admin" || request.apiKey?.scopes.includes("admin")) {
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
