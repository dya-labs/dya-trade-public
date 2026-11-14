import { join } from "node:path";
import { localConfigPath, localStateRoot } from "./local-d1-paths.mjs";
import { getPlatformProxy } from "wrangler";
import { initializeMetadata, activateEmptyDatabase } from "./d1-initialization.mjs";
// This executable only accesses the explicit local emulation binding.
const proxy = await getPlatformProxy({
  configPath: localConfigPath,
  remoteBindings: false,
  envFiles: [],
  // Unlike Vite/Wrangler, getPlatformProxy requires the versioned resource root.
  persist: { path: join(localStateRoot, "v3") },
});
try {
  await initializeMetadata(proxy.env.DYA_ID_DB, "http://localhost:3101");
  await activateEmptyDatabase(proxy.env.DYA_ID_DB, "http://localhost:3101");
  console.log("Local ID D1 initialization verified.");
} catch { console.error("Local ID D1 initialization failed; database left intact."); process.exitCode = 1; }
finally { await proxy.dispose(); }
