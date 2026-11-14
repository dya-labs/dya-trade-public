import { expect, test } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
test.each(["records", "requests"])("schema_2_refuses_existing_%s_without_partial_migration", async (existing) => {
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('test')}}",compatibilityDate:"2026-10-02",d1Databases:{DYA_ID_DB:crypto.randomUUID()}}));
  try {
    const db=await mf.getD1Database("DYA_ID_DB");
    const first=await readFile(new URL("../d1-migrations/0001_wallet_records.sql",import.meta.url),"utf8");
    const next=await readFile(new URL("../d1-migrations/0002_dependency_guards.sql",import.meta.url),"utf8");
    const split=(sql:string)=>sql.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE (?:TABLE|INDEX)[^;]+;|(?:ALTER|DROP|INSERT|UPDATE)[^;]+;/g)??[];
    for(const statement of split(first)) await db.prepare(statement).run();
    await db.prepare("INSERT INTO id_metadata(id,origin,schema_version,requests) VALUES(1,'http://localhost:3101',1,?)").bind(existing==="requests"?"[123]":"[]").run();
    if(existing==="records") await db.prepare("INSERT INTO id_accounts VALUES('a',?)").bind('{"id":"a","kind":"passkey"}').run();
    await expect(db.batch(split(next).map(sql=>db.prepare(sql)))).rejects.toThrow(/CHECK/);
    expect(await db.prepare("SELECT schema_version FROM id_metadata").first("schema_version")).toBe(1);
    expect(await db.prepare("SELECT requests FROM id_metadata").first("requests")).toBe(existing==="requests"?"[123]":"[]");
    expect(await db.prepare("SELECT count(*) n FROM id_accounts").first("n")).toBe(existing==="records"?1:0);
    expect(await db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='id_versions'").first("n")).toBe(0);
  } finally {await mf.dispose();}
});
