import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { harness, origin, twoConflictsPerCommit } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { handleNear } from "../src/near/http/api";
import { authenticator } from "./fixtures/authenticator";
import { createHash } from "node:crypto";
import { handleService, completeConnection, completeApproval } from "../src/bridge/service";
import { createConfidentialOwnershipProbe, intentsIdentity } from "../src/near/auth/intents";
import { PRIVATE_SALT } from "../../../packages/wallet-contracts/src/domain/confidential";
import { saveChallenge } from "../src/near/services/workflow-context";
import { hash } from "../src/near/repositories/store";
import { rememberConfidentialSession, withConfidentialSession } from "../src/near/services/confidential-sessions";
const provider = vi.hoisted(() => ({ refresh:vi.fn(), authenticate:vi.fn() }));
vi.mock("../src/near/providers/confidential", () => ({ refreshConfidential:provider.refresh, authenticateConfidential:provider.authenticate }));
const scenarios = [{ profile: "free", conflicts: false }, { profile: "paid", conflicts: true }] as const;
const transportFor = (db: typeof h.db, conflicts: boolean) => conflicts ? twoConflictsPerCommit(db) : { db, conflicts: () => 0 };
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
  vi.stubEnv("APP_ORIGIN",origin);vi.stubEnv("WEBAUTHN_RP_ID","localhost");vi.stubEnv("CONFIDENTIAL_SESSION_KEY","44".repeat(32));
  provider.refresh.mockReset();provider.authenticate.mockReset();
  vi.stubEnv("DYA_TERMINAL_ORIGIN","http://localhost:3100");vi.stubEnv("DYA_SERVICE_SECRET","synthetic-secret");
});
afterEach(async () => {await h.mf.dispose();vi.unstubAllEnvs();});
const store = (db = h.db, budget = new StatementBudget("paid")) => new D1Store(db,origin,budget);
test.each(scenarios)("real_synthetic_registration_and_login_$profile / conflicts=$conflicts", async ({profile, conflicts}) => {
  async function call(path:string,body:unknown,cookie="") {
    const transport=transportFor(h.db, conflicts),budget=new StatementBudget(profile);
    const request=new NextRequest(`${origin}/api/near/${path}`,{method:"POST",headers:{host:"localhost:3101",origin,"content-type":"application/json",cookie},body:JSON.stringify(body)});
    const response=await handleNear(request,path.split("/"),store(transport.db,budget),undefined,undefined,undefined,budget);
    expect(response.status,await response.clone().text()).toBe(200);
    expect(budget.used).toBeLessThanOrEqual(budget.limit);
    // Atomic challenge commands have no stale dependencies to inject conflicts into.
    expect(transport.conflicts()).toBeGreaterThanOrEqual(conflicts && !path.endsWith("/options") ? 2 : 0);
    return response;
  }
  const passkey=authenticator(origin);
  let response=await call("auth/register/options",{});
  let cookie=response.headers.get("set-cookie")!.split(";")[0];
  let options=await response.json();
  response=await call("auth/register/verify",passkey.registration(options.challenge),cookie);
  expect(response.headers.get("set-cookie")).toContain("near_session=");
  response=await call("auth/login/options",{});
  cookie=response.headers.get("set-cookie")!.split(";")[0];options=await response.json();
  await call("auth/login/verify",passkey.assertion(options.challenge,1),cookie);
  expect(await store().read(s=>Object.values(s.accounts)[0].counter)).toBe(1);
});
test.each(scenarios)("mock_provider_refresh_$profile / conflicts=$conflicts", async ({profile, conflicts}) => {
  await store().transaction(s=>{s.accounts.a={id:"a",kind:"passkey"};s.sessions[hash("session")]={accountId:"a",expires:Date.now()+3600000};});
  await rememberConfidentialSession(store(),"session","a",{accessToken:"expired",refreshToken:"synthetic-refresh",expiresIn:1,refreshExpiresIn:3600});
  provider.refresh.mockResolvedValue({accessToken:"renewed",expiresIn:600});
  const transport=transportFor(h.db, conflicts),budget=new StatementBudget(profile);
  const result=await withConfidentialSession(store(transport.db,budget),"session","a",async token=>token);
  expect(result).toBe("renewed");expect(provider.refresh).toHaveBeenCalledTimes(1);
  expect(transport.conflicts()).toBe(conflicts ? 4 : 0);expect(budget.used).toBeLessThanOrEqual(budget.limit);
});

test.each([...scenarios, {profile: "free", conflicts: true} as const])("complete_nested_approval_$profile / conflicts=$conflicts", async ({profile, conflicts}) => {
  const passkey=authenticator(origin);
  async function wallet(path:string,body:unknown,cookie="") {
    return handleNear(new NextRequest(`${origin}/api/near/${path}`,{method:"POST",headers:{host:"localhost:3101",origin,"content-type":"application/json",cookie},body:JSON.stringify(body)}),path.split("/"),store());
  }
  let response=await wallet("auth/register/options",{});
  const options=await response.json();
  response=await wallet("auth/register/verify",passkey.registration(options.challenge),response.headers.get("set-cookie")!.split(";")[0]);
  expect(response.status).toBe(200);
  const host=response.headers.get("set-cookie")!.match(/near_session=([^;,]+)/)![1];
  const verifier="v".repeat(43),verifierHash=createHash("sha256").update(verifier).digest("base64url");
  async function service(body:unknown,db=h.db,budget=new StatementBudget(profile)) {
    return handleService(new NextRequest(`${origin}/api/service`,{method:"POST",headers:{"x-dya-service-secret":"synthetic-secret","content-type":"application/json"},body:JSON.stringify(body)}),store(db,budget),budget);
  }
  const connection=await (await service({operation:"flow",body:{action:"connect",verifierHash}})).json();
  const code=await completeConnection(connection.flowId,host,store());
  const grant=await (await service({operation:"exchange",flowId:connection.flowId,code:code.code,verifier})).json();
  const account=await store().read(s=>Object.values(s.accounts)[0]);
  const probe=createConfidentialOwnershipProbe(intentsIdentity(account.publicKey!),PRIVATE_SALT);
  const challenge=probe.challenge.toString("base64url");
  await store().transaction(s=>{
    s.sessions[hash(grant.session)].ceremony="ceremony";
    s.challenges[hash("ceremony")]={purpose:"confidential-auth",accountId:account.id,value:challenge,payload:probe.payload,expires:probe.expires};
  });
  let transport=transportFor(h.db, conflicts),budget=new StatementBudget(profile);
  response=await service({operation:"flow",session:grant.session,body:{action:"approval",verifierHash,challenge}},transport.db,budget);
  expect(response.status).toBe(200);expect(transport.conflicts()).toBe(conflicts ? 2 : 0);
  const flow=await response.json();
  transport=transportFor(h.db, conflicts);budget=new StatementBudget(profile);
  provider.authenticate.mockResolvedValue({accessToken:"synthetic-access",refreshToken:"synthetic-refresh",expiresIn:3600,refreshExpiresIn:3600});
  const result=await completeApproval(flow.flowId,passkey.assertion(challenge,1),store(transport.db,budget),budget);
  if (profile === "free" && conflicts) {
    expect(result).toMatchObject({status:503});
    expect(budget.exhausted).toBe(true);
    expect(provider.authenticate).not.toHaveBeenCalled();
    expect(await store().read(s=>s.challenges[hash(flow.flowId)].hostedFlow?.status)).toBe("running");
    await expect(completeApproval(flow.flowId,passkey.assertion(challenge,1),store())).rejects.toThrow("Approval already started");
    return;
  }
  expect(result).toMatchObject({status:200,body:{unlocked:true}});
  expect(provider.authenticate).toHaveBeenCalledTimes(1);
  expect(transport.conflicts()).toBe(conflicts ? 10 : 0);expect(budget.used).toBeLessThanOrEqual(budget.limit);
});

test("atomic_bulk_cleanup_fits_free_without_snapshot_retries", async () => {
  const profile = "free", conflicts = true;
  await store().transaction(s=>{for(let i=0;i<100;i++){s.challenges[hash(`c${i}`)]={purpose:"login",value:"expired",expires:0};s.sessions[hash(`s${i}`)]={accountId:"expired",expires:0};}});
  const transport=transportFor(h.db, conflicts),budget=new StatementBudget(profile);
  await saveChallenge(store(transport.db,budget),{purpose:"login",value:"new",expires:Date.now()+60000},undefined);
  expect(budget.used).toBe(8);expect(transport.conflicts()).toBe(0);
  expect(await store().read(s=>Object.keys(s.sessions))).toEqual([]);
  expect(await store().read(s=>Object.keys(s.challenges))).toHaveLength(1);
});
