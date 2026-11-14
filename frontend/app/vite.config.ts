import { DYA_BRAND, DYA_URLS } from "@dya/config";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The build's commit for the footer (packages/ui/src/lib/release.ts).
function buildCommit() {
  try { return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "unknown"; }
}

export default defineConfig({
  plugins: [{ name: "dya-public-brand", transformIndexHtml: (html: string) => html.replaceAll("__DYA_APP_TITLE__", `${DYA_BRAND.name} · ${DYA_BRAND.tagline}`).replaceAll("__DYA_APP_NAME__", DYA_BRAND.name).replaceAll("__DYA_APP_DESC__", DYA_BRAND.desc).replaceAll("__DYA_OG_IMAGE__", new URL("/og.jpg", DYA_URLS.app).href) }, ...react(), tailwindcss(), cloudflare()],
  define: {
    __DYA_BUILD_COMMIT__: JSON.stringify(buildCommit()),
    // Public links read by @dya/config (DYA_APP_URL, DYA_ID_URL, DYA_DOCS_URL).
    "process.env.DYA_APP_URL": JSON.stringify(DYA_URLS.app),
    "process.env.DYA_ID_URL": JSON.stringify(DYA_URLS.id),
    "process.env.DYA_DOCS_URL": JSON.stringify(DYA_URLS.docs),
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  server: { port: 3100, strictPort: true },
});
