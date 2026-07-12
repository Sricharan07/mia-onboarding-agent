import { spawn } from "node:child_process";

const iterations = positiveInteger(process.env.MIA_VOICE_ACCEPTANCE_ITERATIONS ?? "3");

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  process.stdout.write(`Voice acceptance ${iteration}/${iterations}\n`);
  await runOnce();
}

function runOnce() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/voice-acceptance.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Voice acceptance failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error("MIA_VOICE_ACCEPTANCE_ITERATIONS must be an integer from 1 to 20.");
  }
  return parsed;
}
