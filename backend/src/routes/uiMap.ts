import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyAppAccess, requireApiKeyScope } from "./auth.js";

const scanSchema = z.object({
  routes: z.array(z.string()).min(1).optional(),
  auth: z.object({ mode: z.enum(["none", "login_form", "manual"]) }).optional()
});

const interactiveSessionParamsSchema = z.object({ sessionId: z.string().min(1) });

export async function registerUiMapRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/apps/:appId/ui-map/scan", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const body = scanSchema.parse(request.body);
    return dependencies.services.uiMap.scanApp({ appId: params.appId, ...body });
  });

  app.post("/api/v1/apps/:appId/ui-map/preflight", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const body = scanSchema.parse(request.body);
    return dependencies.services.uiMap.preflightApp({ appId: params.appId, ...body });
  });

  app.get("/api/v1/apps/:appId/ui-map/versions", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["ui-map:read"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    requireApiKeyAppAccess(request, dependencies, params.appId);
    return { items: dependencies.repositories.listUiMapVersions(params.appId) };
  });

  app.get("/api/v1/ui-map/:uiMapVersionId/pages", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["ui-map:read"])
  }, async (request) => {
    const params = z.object({ uiMapVersionId: z.string() }).parse(request.params);
    const version = dependencies.repositories.getUiMapVersion(params.uiMapVersionId);
    requireApiKeyAppAccess(request, dependencies, String(version.app_id));
    return { items: dependencies.repositories.listPages(params.uiMapVersionId) };
  });

  app.get("/api/v1/pages/:pageId/elements", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["ui-map:read"])
  }, async (request) => {
    const params = z.object({ pageId: z.string() }).parse(request.params);
    const query = z.object({
      selectorQuality: z.string().optional(),
      elementType: z.string().optional()
    }).parse(request.query);
    const page = dependencies.repositories.getPage(params.pageId);
    requireApiKeyAppAccess(request, dependencies, page.appId);
    return { items: dependencies.repositories.listElements(params.pageId, query) };
  });

  app.patch("/api/v1/apps/:appId/ui-map/elements/:elementRowId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ appId: z.string(), elementRowId: z.string() }).parse(request.params);
    const body = z.object({
      description: z.string().optional(),
      tags: z.array(z.string()).optional()
    }).parse(request.body);
    requireApiKeyAppAccess(request, dependencies, params.appId);
    dependencies.repositories.updateLatestElement(params.appId, params.elementRowId, body);
    return { ok: true };
  });

  app.get("/api/v1/ui-map/interactive-sessions", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async () => ({
    items: dependencies.services.interactiveUiMap.list()
  }));

  app.post("/api/v1/apps/:appId/ui-map/interactive-sessions", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const body = scanSchema.parse(request.body);
    return dependencies.services.interactiveUiMap.start({ appId: params.appId, ...body });
  });

  app.get("/api/v1/ui-map/interactive-sessions/:sessionId", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    return dependencies.services.interactiveUiMap.get(params.sessionId);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/goto", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    const body = z.object({
      route: z.string().min(1),
      captureDefault: z.boolean().optional()
    }).parse(request.body);
    return dependencies.services.interactiveUiMap.goto(params.sessionId, body);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/capture-state", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    const body = z.object({
      stateName: z.string().min(1),
      stateReason: z.string().optional()
    }).parse(request.body);
    return dependencies.services.interactiveUiMap.captureState(params.sessionId, body);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/finish", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    return dependencies.services.interactiveUiMap.finish(params.sessionId);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/cancel", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    const body = z.object({ reason: z.string().optional() }).parse(request.body ?? {});
    return dependencies.services.interactiveUiMap.cancel(params.sessionId, body.reason);
  });
}
