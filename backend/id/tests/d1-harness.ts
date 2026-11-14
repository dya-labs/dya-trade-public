import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import type { D1Client } from "../src/near/repositories/d1-records";
import { initializeMetadata, activateEmptyDatabase } from "../scripts/d1-initialization.mjs";
export const origin = "http://localhost:3101";
export async function harness(activate = true, persistence?: {path: string; id: string}, initialize = true, networks = true, tokenImages = true) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('test'); } };", compatibilityDate: "2026-10-02", d1Databases: { DYA_ID_DB: persistence?.id ?? crypto.randomUUID() }, ...(persistence ? {resourcePersistencePath: persistence.path} : {}) }));
  const db = await mf.getD1Database("DYA_ID_DB");
  const schema = (await Promise.all(["0001_wallet_records.sql", "0002_dependency_guards.sql", "0003_access_records.sql", ...(networks ? ["0004_networks.sql", "0005_tokens.sql", ...(tokenImages ? ["0006_token_images.sql"] : [])] : [])].map(name => readFile(new URL(`../d1-migrations/${name}`, import.meta.url), "utf8")))).join("\n");
  if (initialize) {
    const statements = (schema.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE (?:TABLE|INDEX)[^;]+;|(?:ALTER|DROP|INSERT|UPDATE)[^;]+;/g) ?? []).map(sql => db.prepare(sql.trim()));
    // Fixed seed migrations contain hundreds of rows. Batch setup to avoid exhausting
    // local ephemeral ports across the full workerd suite; runtime budgets are tested separately.
    for (let offset = 0; offset < statements.length; offset += 50) await db.batch(statements.slice(offset, offset + 50));
  }
  await initializeMetadata(db, origin);
  if (activate) await activateEmptyDatabase(db, origin);
  return { mf, db: db as unknown as D1Client, raw: db };
}
/** Both snapshots complete before either caller attempts the first guard. */
export function synchronized(db: D1Client, callers = 2): D1Client {
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  return {
    prepare: db.prepare.bind(db),
    async batch<T>(statements: D1PreparedStatement[]) {
      const result = await db.batch<T>(statements);
      if (statements.length === 1 && arrived < callers) {
        if (++arrived === callers) release();
        await barrier;
      }
      return result;
    },
  };
}
/** Two actual SQL-version conflicts before every successful guarded commit. */
export function twoConflictsPerCommit(db: D1Client) {
  const guards = new WeakMap<D1PreparedStatement, {collection:string;id:string;version:number}[]>();
  let attempts = 0, conflicts = 0;
  const client: D1Client = {
    prepare(sql) {
      const statement = db.prepare(sql);
      if (!sql.startsWith("INSERT INTO id_write_guards")) return statement;
      return new Proxy(statement, {get(target,key) {
        if (key === "bind") return (...values: Parameters<D1PreparedStatement["bind"]>) => {
          const bound = target.bind(...values);
          guards.set(bound,JSON.parse(String(values[4])));
          return bound;
        };
        const value = Reflect.get(target,key);
        return typeof value === "function" ? value.bind(target) : value;
      }});
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const dependencies = guards.get(statements[0]);
      if (dependencies?.length && attempts < 2) {
        const dependency = dependencies.find(d => d.collection !== "metadata") ?? dependencies[0];
        await db.prepare("INSERT INTO id_versions VALUES(?,?,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1").bind(dependency.collection,dependency.id).run();
        attempts++; conflicts++;
      }
      const result = await db.batch<T>(statements);
      if (dependencies) attempts = 0;
      return result;
    },
  };
  return { db: client, conflicts: () => conflicts };
}
