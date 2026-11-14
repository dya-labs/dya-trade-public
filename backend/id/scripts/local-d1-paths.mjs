import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const localConfigPath = fileURLToPath(new URL("../../../frontend/id/wrangler.local.jsonc", import.meta.url));
// Integration tests use a fresh temporary root; normal commands share this fixed default.
export const localStateRoot = process.env.DYA_ID_D1_LOCAL_STATE
  ? resolve(process.env.DYA_ID_D1_LOCAL_STATE)
  : fileURLToPath(new URL("../../../frontend/id/.wrangler/state", import.meta.url));
