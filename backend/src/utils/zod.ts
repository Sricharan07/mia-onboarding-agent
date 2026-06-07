import type { z } from "zod";
import { ValidationAppError } from "./errors.js";

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new ValidationAppError("Request validation failed.", result.error.issues);
  }

  return result.data;
}
