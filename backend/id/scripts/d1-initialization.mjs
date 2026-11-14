/** Fresh-only setup. Metadata initialization never activates a database. */
export const ENTITY_TABLES = ["id_accounts", "id_sessions", "id_challenges", "id_orders", "id_trades", "id_deposits", "id_withdrawals", "id_access_records"];
export const metadataInsertSQL = "INSERT INTO id_metadata(id,origin,schema_version) VALUES(1,?,2) ON CONFLICT(id) DO NOTHING";
export const metadataSelectSQL = "SELECT origin,schema_version,readiness FROM id_metadata WHERE id=1";
export const emptyActivationSQL = `UPDATE id_metadata SET readiness='ready',revision=revision+1 WHERE id=1 AND origin=? AND schema_version=2 AND readiness='initializing' AND json_array_length(requests)=0 AND ${[...ENTITY_TABLES, "id_write_guards"].map(t => `NOT EXISTS(SELECT 1 FROM ${t})`).join(" AND ")} RETURNING id`;
export async function initializeMetadata(db, origin) {
  const url = new URL(origin);
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || (url.protocol === "http:" && url.hostname !== "localhost")) throw new Error("Canonical ID origin required");
  await db.prepare(metadataInsertSQL).bind(origin).run();
  const metadata = await db.prepare(metadataSelectSQL).first();
  if (metadata?.origin !== origin || metadata.schema_version !== 2) throw new Error("ID database initialization mismatch");
  return metadata;
}
export async function activateEmptyDatabase(db, origin) {
  const metadata = await db.prepare(metadataSelectSQL).first();
  if (metadata?.origin !== origin || metadata.schema_version !== 2) throw new Error("ID database initialization mismatch");
  if (metadata.readiness === "ready") return;
  // All emptiness predicates are evaluated within this one atomic UPDATE.
  const result = await db.prepare(emptyActivationSQL).bind(origin).all();
  if (!result.success || result.results.length !== 1) throw new Error("Empty ID database activation refused");
}
