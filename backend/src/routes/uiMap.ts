import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { requireApiKeyScopeIfPresent } from "./auth.js";

const scanSchema = z.object({
  routes: z.array(z.string()).min(1),
  auth: z.object({ mode: z.enum(["none", "login_form"]) }).optional()
});

const interactiveSessionParamsSchema = z.object({ sessionId: z.string().min(1) });

export async function registerUiMapRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post("/api/v1/apps/:appId/ui-map/scan", async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const body = scanSchema.parse(request.body);
    return dependencies.services.uiMap.scanApp({ appId: params.appId, ...body });
  });

  app.get("/api/v1/apps/:appId/ui-map/versions", {
    preHandler: (request, reply) => requireApiKeyScopeIfPresent(request, reply, dependencies, ["ui-map:read"])
  }, async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    return { items: dependencies.repositories.listUiMapVersions(params.appId) };
  });

  app.get("/api/v1/ui-map/:uiMapVersionId/pages", {
    preHandler: (request, reply) => requireApiKeyScopeIfPresent(request, reply, dependencies, ["ui-map:read"])
  }, async (request) => {
    const params = z.object({ uiMapVersionId: z.string() }).parse(request.params);
    return { items: dependencies.repositories.listPages(params.uiMapVersionId) };
  });

  app.get("/api/v1/pages/:pageId/elements", {
    preHandler: (request, reply) => requireApiKeyScopeIfPresent(request, reply, dependencies, ["ui-map:read"])
  }, async (request) => {
    const params = z.object({ pageId: z.string() }).parse(request.params);
    const query = z.object({
      selectorQuality: z.string().optional(),
      elementType: z.string().optional()
    }).parse(request.query);
    return { items: dependencies.repositories.listElements(params.pageId, query) };
  });

  app.patch("/api/v1/elements/:elementId", async (request) => {
    const params = z.object({ elementId: z.string() }).parse(request.params);
    const body = z.object({
      description: z.string().optional(),
      tags: z.array(z.string()).optional()
    }).parse(request.body);
    dependencies.repositories.updateElement(params.elementId, body);
    return { ok: true };
  });

  app.get("/api/v1/ui-map/interactive-sessions", async () => ({
    items: dependencies.services.interactiveUiMap.list()
  }));

  app.post("/api/v1/apps/:appId/ui-map/interactive-sessions", async (request) => {
    const params = z.object({ appId: z.string() }).parse(request.params);
    const body = scanSchema.parse(request.body);
    return dependencies.services.interactiveUiMap.start({ appId: params.appId, ...body });
  });

  app.get("/api/v1/ui-map/interactive-sessions/:sessionId", async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    return dependencies.services.interactiveUiMap.get(params.sessionId);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/goto", async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    const body = z.object({
      route: z.string().min(1),
      captureDefault: z.boolean().optional()
    }).parse(request.body);
    return dependencies.services.interactiveUiMap.goto(params.sessionId, body);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/capture-state", async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    const body = z.object({
      stateName: z.string().min(1),
      stateReason: z.string().optional()
    }).parse(request.body);
    return dependencies.services.interactiveUiMap.captureState(params.sessionId, body);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/finish", async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    return dependencies.services.interactiveUiMap.finish(params.sessionId);
  });

  app.post("/api/v1/ui-map/interactive-sessions/:sessionId/cancel", async (request) => {
    const params = interactiveSessionParamsSchema.parse(request.params);
    const body = z.object({ reason: z.string().optional() }).parse(request.body ?? {});
    return dependencies.services.interactiveUiMap.cancel(params.sessionId, body.reason);
  });
}
