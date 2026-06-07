import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";
import { apiKeyScopes } from "../services/auth/apiKeyService.js";

const apiKeyInputSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(apiKeyScopes)).min(1)
});

export async function registerApiKeyRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/api-keys", async () => ({
    items: dependencies.services.apiKeys.list()
  }));

  app.post("/api/v1/api-keys", async (request) => {
    const body = apiKeyInputSchema.parse(request.body);
    return dependencies.services.apiKeys.create(body);
  });

  app.delete("/api/v1/api-keys/:keyId", async (request) => {
    const params = z.object({ keyId: z.string().min(1) }).parse(request.params);
    return dependencies.services.apiKeys.revoke(params.keyId);
  });
}
