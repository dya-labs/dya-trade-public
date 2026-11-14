import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { harness, origin } from "./d1-harness";
import { saveChallenge } from "../src/near/services/workflow-context";
import { hash } from "../src/near/repositories/store";
import { handleService, completeConnection } from "../src/bridge/service";
import { NextRequest } from "next/server";
import { StorageConflictError } from "../src/near/repositories/storage-error";
import type { D1Client } from "../src/near/repositories/d1-records";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => { h = await harness(); vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("DYA_TERMINAL_ORIGIN", "http://localhost:3100"); vi.stubEnv("DYA_SERVICE_SECRET", "synthetic-secret"); });
afterEach(async () => { await h?.mf.dispose(); vi.unstubAllEnvs(); });
const s = (db = h.db, budget = new StatementBudget("free")) => new D1Store(db, origin, budget);
test("twenty_independent_clients_complete_finite_burst", async () => {
  await s().transaction(state => { for(let i=0;i<20;i++) state.accounts[`a${i}`]={id:`a${i}`,kind:"passkey",counter:0}; });
  let statements=0, rowsRead=0, rowsWritten=0, conflicts=0, snapshotResultBytes=0;
  const db: D1Client = {prepare: h.db.prepare.bind(h.db), async batch<T>(batch: D1PreparedStatement[]) {
    statements+=batch.length;
    try { const result = await h.db.batch<T>(batch); if(batch.length===1) snapshotResultBytes=Math.max(snapshotResultBytes,Buffer.byteLength(JSON.stringify(result.map(r=>r.results)))); for(const r of result){rowsRead+=r.meta.rows_read;rowsWritten+=r.meta.rows_written;} return result; }
    catch(error){ if(error instanceof Error && error.message.includes("DYA_ID_REVISION_CONFLICT")) conflicts++; throw error; }
  }};
  const budgets=Array.from({length:20},()=>new StatementBudget("free"));
  const started=Date.now();
  const result=await Promise.allSettled(budgets.map((budget,i)=>s(db,budget).transaction(state=>{ state.accounts[`a${i}`].counter = (state.accounts[`a${i}`].counter ?? 0)+1; })));
  const accounts=await s().read(state=>state.accounts);
  const failed=result.filter(r=>r.status==="rejected");
  result.forEach((r,i)=>expect(accounts[`a${i}`].counter).toBe(r.status==="fulfilled"?1:0));
  for(const r of failed) if(r.status==="rejected") expect(r.reason).toBeInstanceOf(StorageConflictError);
  const measurements={clients:20,successful:20-failed.length,failed:failed.length,conflicts,statements,rowsRead,rowsWritten,snapshotBytes:Buffer.byteLength(JSON.stringify(accounts)),snapshotResultBytes,reservedUnits:budgets.map(b=>b.used),durationMs:Date.now()-started};
  console.info("id.d1.workload",measurements);
  expect(failed.length,"Every client must commit within the fixed three-attempt bound").toBe(0);
});
test("bulk_expired_cleanup_is_atomic_and_fits_free_budget", async () => {
  await s().transaction(state => { for(let i=0;i<100;i++){state.challenges[hash(`c${i}`)]={purpose:"login",value:"synthetic",expires:0};state.sessions[hash(`s${i}`)]={accountId:"expired",expires:0};} });
  const budget=new StatementBudget("free");
  await saveChallenge(s(h.db,budget),{purpose:"login",value:"new",expires:Date.now()+60000},undefined);
  expect(await s().read(state=>Object.keys(state.sessions))).toEqual([]);
  expect(await s().read(state=>Object.keys(state.challenges).length)).toBe(1);
  expect(budget.used).toBe(8); expect(budget.statements).toBe(8);
});
test("connection_complete_request_fits_free_with_two_real_conflicts_per_claim", async () => {
  await s().transaction(state=>{state.accounts.a={id:"a",kind:"passkey"};state.sessions[hash("host")]={accountId:"a",expires:Date.now()+60000};});
  let conflictCount=0;
  let dependencies: {collection:string;id:string;version:number}[]=[];
  const db: D1Client={prepare(sql) {
    const prepared=h.db.prepare(sql);
    if (!sql.startsWith("INSERT INTO id_write_guards")) return prepared;
    return new Proxy(prepared,{get(target,key){
      if(key==="bind") return (...values: Parameters<D1PreparedStatement["bind"]>)=>{dependencies=JSON.parse(String(values[4]));return target.bind(...values);};
      const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
    }});
  }, async batch<T>(statements:D1PreparedStatement[]){
    if(statements.length!==1 && conflictCount<2){conflictCount++;const dependency=dependencies.find(d=>d.collection!=="metadata")!;await h.raw.prepare("INSERT INTO id_versions VALUES(?,?,1) ON CONFLICT(collection,record_id) DO UPDATE SET version=version+1").bind(dependency.collection,dependency.id).run();}
    return h.db.batch<T>(statements);
  }};
  let budget=new StatementBudget("free");
  const verifier="v".repeat(43),verifierHash=createHash("sha256").update(verifier).digest("base64url");
  const request=new NextRequest(`${origin}/api/service`,{method:"POST",headers:{"x-dya-service-secret":"synthetic-secret","content-type":"application/json"},body:JSON.stringify({operation:"flow",body:{action:"connect",verifierHash}})});
  const response=await handleService(request,s(db,budget),budget);
  expect(response.status).toBe(200); expect(budget.used).toBeLessThanOrEqual(40);
  const {flowId}=await response.json();conflictCount=0;budget=new StatementBudget("free");
  const completed=await completeConnection(flowId,"host",s(db,budget),budget);
  expect(budget.used).toBeLessThanOrEqual(40);expect(conflictCount).toBe(2);
  conflictCount=0;budget=new StatementBudget("free");
  const exchanged=await handleService(new NextRequest(`${origin}/api/service`,{method:"POST",headers:{"x-dya-service-secret":"synthetic-secret","content-type":"application/json"},body:JSON.stringify({operation:"exchange",flowId,code:completed.code,verifier})}),s(db,budget),budget);
  expect(exchanged.status).toBe(200);expect(budget.used).toBeLessThanOrEqual(40);expect(conflictCount).toBe(2);
});
