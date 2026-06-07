import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDependencies } from "../app.js";

const appInputSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  baseUrl: z.string().url()
});

export async function registerAppRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.get("/api/v1/apps", async () => ({
    items: dependencies.repositories.listApps()
  }));

  app.post("/api/v1/apps", async (request) => {
    const body = appInputSchema.parse(request.body);
    return dependencies.repositories.upsertApp(body);
  });
}
