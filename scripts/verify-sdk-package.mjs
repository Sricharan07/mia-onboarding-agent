import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demoSource = join(root, "example", "demo-crm+sdk");
const temporary = await mkdtemp(join(tmpdir(), "mia-sdk-package-"));
const demo = join(temporary, "demo");

try {
  run("npm", ["pack", "--workspace", "sdk", "--pack-destination", temporary], root);
  const archiveName = (await readdir(temporary)).find((name) => name.endsWith(".tgz"));
  if (!archiveName) throw new Error("npm pack did not create an SDK archive.");
  const archive = join(temporary, archiveName);

  await cp(demoSource, demo, {
    recursive: true,
    filter(source) {
      const path = relative(demoSource, source);
      if (!path) return true;
      const first = path.split(sep)[0];
      if (["node_modules", ".next"].includes(first)) return false;
      return ![".env", ".env.local", ".env.production"].includes(basename(source));
    }
  });

  const manifestPath = join(demo, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies["@mia/onboarding-agent"] = `file:${relative(demo, archive).split(sep).join("/")}`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], demo);
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], demo);
  run("npm", ["run", "build"], demo, { NEXT_TELEMETRY_DISABLED: "1" });
  process.stdout.write(`Verified ${archiveName} in an isolated demo build.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function run(command, args, cwd, environment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}.`);
}
