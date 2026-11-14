// Imported only by server-side ID storage. Never import this module from UI/contracts.
import { StorageUnavailableError } from "../near/repositories/storage-error";
import type { D1Database } from "@cloudflare/workers-types";
export async function loadIdDatabase(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const db = (env as { DYA_ID_DB?: D1Database }).DYA_ID_DB;
  if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") throw new StorageUnavailableError();
  return db;
}
