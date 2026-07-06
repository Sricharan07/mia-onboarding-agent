import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../app.js";
import { requireApiKeyScope } from "./auth.js";

export async function registerSystemRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get(
    "/api/v1/system/readiness",
    {
      preHandler: (request, reply) => requireApiKeyScope(request, reply, dependencies, ["admin"])
    },
    async () => dependencies.services.readiness.check()
  );
}
