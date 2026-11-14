import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  transpilePackages: ["@dya/ui", "@dya/wallet-ui"],
  turbopack: { root: resolve(import.meta.dirname, "../..") },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./.env*", "../../.env*", "../../.git/**/*", "./tests/**/*"] },
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
};
export default config;
