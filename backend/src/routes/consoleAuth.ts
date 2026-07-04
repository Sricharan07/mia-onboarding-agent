import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { extractConsoleSessionToken } from "../services/auth/consoleAuthService.js";
import { AppError } from "../utils/errors.js";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const setupSchema = loginSchema.extend({
  name: z.string().trim().min(1),
  password: z.string().min(12)
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
}
