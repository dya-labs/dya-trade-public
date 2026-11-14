import { localConfigPath, localStateRoot } from "../../backend/id/scripts/local-d1-paths.mjs";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

const localD1 = process.env.DYA_ID_LOCAL_D1 === "1";
export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({ ...(localD1 ? { configPath: localConfigPath, persistState: { path: localStateRoot }, remoteBindings: false } : {}), viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
});
