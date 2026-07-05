import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { extractConsoleSessionToken } from "../services/auth/consoleAuthService.js";
import { AppError } from "../utils/errors.js";
import { requireApiKeyScope } from "./auth.js";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const setupSchema = loginSchema.extend({
  name: z.string().trim().min(1),
  password: z.string().min(12)
});

const createUserSchema = setupSchema;
const passwordChangeSchema = z.object({
  currentPassword: z.string().optional(),
  nextPassword: z.string().min(12)
});

export async function registerConsoleAuthRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/console/auth/status", async (request) => (
    dependencies.services.consoleAuth.status(extractConsoleSessionToken(request.headers))
  ));

  app.post("/api/v1/console/auth/setup", async (request) => {
    const body = setupSchema.parse(request.body);
    const bootstrapToken = typeof request.headers["x-bootstrap-admin-token"] === "string"
      ? request.headers["x-bootstrap-admin-token"]
      : undefined;
    return dependencies.services.consoleAuth.setup({ ...body, bootstrapToken });
  });

  app.post("/api/v1/console/auth/login", async (request) => (
    dependencies.services.consoleAuth.login(loginSchema.parse(request.body))
  ));

  app.post("/api/v1/console/auth/logout", async (request) => {
    const token = extractConsoleSessionToken(request.headers);
    if (!token) {
      throw new AppError("CONSOLE_SESSION_REQUIRED", "A valid console session is required.", 401);
    }
    dependencies.services.consoleAuth.logout(token);
    return { ok: true };
  });

  app.get("/api/v1/console/users", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async () => ({
    items: dependencies.services.consoleAuth.listUsers()
  }));

  app.post("/api/v1/console/users", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => (
    dependencies.services.consoleAuth.createUser(createUserSchema.parse(request.body))
  ));

  app.patch("/api/v1/console/users/:userId/password", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = passwordChangeSchema.parse(request.body);
    if (!request.consoleSession) {
      throw new AppError("CONSOLE_SESSION_REQUIRED", "A console session is required to change console passwords.", 401);
    }
    return dependencies.services.consoleAuth.changePassword(params.userId, {
      currentPassword: body.currentPassword,
      nextPassword: body.nextPassword,
      actorUserId: request.consoleSession.userId
    });
  });

  app.post("/api/v1/console/users/:userId/disable", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    if (!request.consoleSession) {
      throw new AppError("CONSOLE_SESSION_REQUIRED", "A console session is required to disable console users.", 401);
    }
    return dependencies.services.consoleAuth.disableUser(params.userId, request.consoleSession.userId);
  });

  app.get("/api/v1/console/sessions", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async () => ({
    items: dependencies.services.consoleAuth.listSessions()
  }));

  app.post("/api/v1/console/sessions/:sessionId/revoke", {
    preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
  }, async (request) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    dependencies.services.consoleAuth.revokeSession(params.sessionId);
    return { ok: true };
  });
}
