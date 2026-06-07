import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(projectRoot, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["sdk"],
  turbopack: {
    root: workspaceRoot,
  },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/default",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
