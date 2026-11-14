import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query"], alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    deps: { interopDefault: false },
    server: { deps: { inline: ["@dya/wallet-ui"] } },
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
})
