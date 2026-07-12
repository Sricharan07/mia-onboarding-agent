import assert from "node:assert/strict";
import test from "node:test";
import { ZodError } from "zod";
import { AppError } from "../src/utils/errors.js";
import { requestErrorLogLevel } from "../src/v1/app.js";

test("request logging distinguishes expected client failures from server failures", () => {
  assert.equal(requestErrorLogLevel(new AppError("SETUP_COMPLETE", "Already configured.", 409)), "warn");
  assert.equal(requestErrorLogLevel(new AppError("UPSTREAM_FAILED", "Provider failed.", 502)), "error");
  assert.equal(requestErrorLogLevel(new ZodError([])), "warn");
  assert.equal(requestErrorLogLevel(Object.assign(new Error("Missing"), { statusCode: 404 })), "warn");
  assert.equal(requestErrorLogLevel(new Error("Unexpected")), "error");
});
