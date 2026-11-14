import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { emptyState, hash, type State, type StateStore } from "../../../backend/id/src/near/repositories/store";
import { handleService, completeConnection, completeApproval, readFlow } from "../../../backend/id/src/bridge/service";
import { CEREMONY, saveChallenge } from "../../../backend/id/src/near/services/workflow-context";
import { authenticationOptions } from "../../../packages/wallet-contracts/src/http/schemas/account";
import { handleNear } from "../../../backend/id/src/near/http/api";
vi.mock("../../../backend/id/src/near/http/api", () => ({ handleNear: vi.fn(async () => NextResponse.json({ unlocked: true })) }));
const verifier = "v".repeat(43), verifierHash = createHash("sha256").update(verifier).digest("base64url");
let state: State;
let store: StateStore;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://localhost:3101"); vi.stubEnv("DYA_TERMINAL_ORIGIN", "http://localhost:3100"); vi.stubEnv("DYA_SERVICE_SECRET", "test-service-secret");
  state = emptyState();
  // No public key: the session snapshot would derive an Intents identity from it.
  state.accounts.alice = { id: "alice", kind: "passkey", credentialId: "credential", counter: 0 };
  state.sessions[hash("host-session")] = { accountId: "alice", expires: Date.now() + 600000 };
  store = { read: fn => fn(state), transaction: fn => fn(state) };
});
async function service(body: unknown, secret = "test-service-secret") {
  return handleService(new NextRequest("http://localhost:3101/api/service", { method: "POST", headers: { "x-dya-service-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(body) }), store);
}
async function connect() {
  const flow = await (await service({ operation: "flow", body: { action: "connect", verifierHash } })).json();
  const completion = await completeConnection(flow.flowId, "host-session", store);
  const response = await service({ operation: "exchange", flowId: flow.flowId, code: completion.code, verifier });
  return { session: (await response.json()).session as string, flow, completion };
}
it("requires the server client credential before exposing wallet data", async () => {
  const response = await service({ operation: "request", path: "state" }, "wrong");
  expect(response.status).toBe(403); expect(handleNear).not.toHaveBeenCalled();
});
it("requires a wallet session and exchanges a one-time code bound to PKCE", async () => {
  const flow = await (await service({ operation: "flow", body: { action: "connect", verifierHash } })).json();
  await expect(completeConnection(flow.flowId, undefined, store)).rejects.toThrow("Sign in");
  const completion = await completeConnection(flow.flowId, "host-session", store);
  const bad = await service({ operation: "exchange", flowId: flow.flowId, code: completion.code, verifier: "wrong" });
  expect(bad.status).toBe(400);
  const good = await service({ operation: "exchange", flowId: flow.flowId, code: completion.code, verifier });
  expect(good.status).toBe(200);
  const { session, state: snapshot } = await good.json(); expect(state.sessions[hash(session)].clientOrigin).toBe("http://localhost:3100");
  expect(snapshot.account.id).toBe("alice");
  expect(state.sessions[hash(session)].confidential).toBeUndefined();
  expect((await service({ operation: "exchange", flowId: flow.flowId, code: completion.code, verifier })).status).toBe(400);
});
it("blocks raw signing/submission and invalid or expired client grants", async () => {
  const { session } = await connect();
  expect((await service({ operation: "request", path: "transfers/submit", body: {}, session })).status).toBe(400);
  expect((await service({ operation: "request", path: "auth/register/verify", body: {}, session })).status).toBe(400);
  expect((await service({ operation: "request", path: "confidential/unlock?ignored=1", body: {}, session })).status).toBe(400);
  state.sessions[hash(session)].clientOrigin = "https://other.test";
  expect((await service({ operation: "request", path: "live/balances", session })).status).toBe(400);
  expect(handleNear).not.toHaveBeenCalled();
});
it("binds approval to the stored challenge, account, grant, and submission route", async () => {
  const { session } = await connect();
  state.sessions[hash(session)].ceremony = "ceremony";
  state.challenges[hash("ceremony")] = { value: "challenge", purpose: "confidential-auth", accountId: "alice", expires: Date.now() + 60000, payload: "private" };
  expect((await service({ operation: "flow", body: { action: "approval", verifierHash, challenge: "other" }, session })).status).toBe(400);
  const flow = await (await service({ operation: "flow", body: { action: "approval", verifierHash, challenge: "challenge" }, session })).json();
  const record = await readFlow(flow.flowId, store);
  expect(authenticationOptions.parse(record.hostedFlow!.options).allowCredentials).toEqual([{ type: "public-key", id: "credential" }]);
  expect(JSON.stringify(record.hostedFlow!.review)).not.toContain("private");
  expect(record.hostedFlow!.session).not.toBe(session);
  expect((await service({ operation: "receipt", flowId: flow.flowId, path: "confidential/unlock", session })).status).toBe(400);
  await completeApproval(flow.flowId, { id: "credential" }, store);
  expect(handleNear).toHaveBeenCalledTimes(1);
  await expect(completeApproval(flow.flowId, {}, store)).rejects.toThrow("already started");
  expect(handleNear).toHaveBeenCalledTimes(1);
  expect((await service({ operation: "receipt", flowId: flow.flowId, path: "transfers/submit", session })).status).toBe(400);
  const receipt = await service({ operation: "receipt", flowId: flow.flowId, path: "confidential/unlock", session });
  expect(await receipt.json()).toEqual({ unlocked: true });
  expect(handleNear).toHaveBeenCalledTimes(1);
});
it("does not leak wallet cookies through the client service and revokes the app grant", async () => {
  const { session } = await connect();
  vi.mocked(handleNear).mockImplementationOnce(async () => { const response = NextResponse.json({ account: null }); response.cookies.set("near_session", "secret"); return response; });
  const response = await service({ operation: "request", path: "state", session });
  expect(response.headers.get("set-cookie")).toBeNull();
  expect((await service({ operation: "request", path: "connection/revoke", body: {}, session })).status).toBe(200);
  expect(state.sessions[hash(session)]).toBeUndefined();
  expect(state.sessions[hash("host-session")]).toBeDefined();
});
it("rejects expired hosted requests", async () => {
  const flow = await (await service({ operation: "flow", body: { action: "connect", verifierHash } })).json();
  state.challenges[hash(flow.flowId)].expires = Date.now() - 1;
  await expect(readFlow(flow.flowId, store)).rejects.toThrow("expired");
});

it("rejects expired and revoked grants before reading data or creating approvals", async () => {
  const { session } = await connect();
  state.sessions[hash(session)].expires = Date.now() - 1;
  expect((await service({ operation: "request", path: "live/balances", session })).status).toBe(400);
  expect((await service({ operation: "flow", body: { action: "approval", verifierHash, challenge: "challenge" }, session })).status).toBe(400);
  expect(await (await service({ operation: "request", path: "state", session })).json()).toMatchObject({ account: null });
  delete state.sessions[hash(session)];
  expect((await service({ operation: "request", path: "live/balances", session })).status).toBe(400);
  expect(handleNear).not.toHaveBeenCalled();
});

it("allows only public catalog reads before wallet connection",async()=>{for(const path of ["catalog","token-icons"]){expect((await service({operation:"request",path})).status).toBe(200);}expect(handleNear).toHaveBeenCalledTimes(2);expect((await service({operation:"request",path:"feedback"})).status).toBe(400);});

it("forwards quote stage timings, followed by the service's own stages, without exposing cookies", async () => {
  const { session } = await connect();
  vi.mocked(handleNear).mockImplementationOnce(async () => {
    const response = NextResponse.json({ principal: "1" }, { headers: { "Server-Timing": "quote_oneclick;dur=1250, quote_total;dur=1650" } });
    response.cookies.set("near_session", "secret");
    return response;
  });
  const response = await service({ operation: "request", path: "live/preview", body: {}, session });
  // The handler's stages come first and unchanged; the service appends its own, ending with its total.
  expect(response.headers.get("Server-Timing")).toMatch(/^quote_oneclick;dur=1250, quote_total;dur=1650, id_grant;dur=[\d.]+, .*id_total;dur=[\d.]+$/);
  expect(response.headers.has("set-cookie")).toBe(false);
});

it("creates the approval flow with a prepared ceremony only when asked, bound like a separately created one", async () => {
  const { session } = await connect();
  const prepare = (ceremony: string) => vi.mocked(handleNear).mockImplementationOnce(async () => {
    state.challenges[hash(ceremony)] = { value: `challenge-${ceremony}`, purpose: "market-trade", accountId: "alice", expires: Date.now() + 60000, payload: "private" };
    const response = NextResponse.json({ review: { principal: "1" } });
    response.cookies.set(CEREMONY, ceremony);
    return response;
  });
  prepare("plain");
  const plain = await (await service({ operation: "request", path: "live/market/prepare", body: {}, session })).json();
  expect(plain).not.toHaveProperty("walletFlow");
  expect(state.sessions[hash(session)].ceremony).toBe("plain");
  prepare("bound");
  const prepared = await (await service({ operation: "request", path: "live/market/prepare", body: {}, session, approvalFlow: { verifierHash } })).json();
  expect(state.sessions[hash(session)].ceremony).toBe("bound");
  const record = await readFlow(prepared.walletFlow.flowId, store);
  expect(prepared.walletFlow.url).toBe(`http://localhost:3101/flow/${prepared.walletFlow.flowId}`);
  expect(record.hostedFlow).toMatchObject({ kind: "approval", verifierHash, submitRoute: "live/market/submit" });
  expect(authenticationOptions.parse(record.hostedFlow!.options)).toMatchObject({ challenge: "challenge-bound", allowCredentials: [{ type: "public-key", id: "credential" }] });
  expect(JSON.stringify(record.hostedFlow!.review)).not.toContain("private");
  await completeApproval(prepared.walletFlow.flowId, { id: "credential" }, store);
  expect((await service({ operation: "receipt", flowId: prepared.walletFlow.flowId, path: "live/market/submit", session })).status).toBe(200);
});

it("returns the approval flow of a ceremony the wallet bound in the write that saved its challenge", async () => {
  const { session } = await connect();
  const prepare = () => vi.mocked(handleNear).mockImplementationOnce(async (...args) => {
    const ceremony = await saveChallenge(store, { value: "challenge-bound", purpose: "market-trade", accountId: "alice", expires: Date.now() + 60000, payload: "private" }, state.sessions[hash(session)].ceremony, args[7]?.bind);
    const response = NextResponse.json({ review: { principal: "1" } });
    response.cookies.set(CEREMONY, ceremony);
    return response;
  });
  prepare();
  const plain = await (await service({ operation: "request", path: "live/market/prepare", body: {}, session })).json();
  expect(plain).not.toHaveProperty("walletFlow");
  const first = state.sessions[hash(session)].ceremony!;
  expect(Object.values(state.challenges).map(c => c.purpose)).toEqual(["market-trade"]);
  prepare();
  const response = await service({ operation: "request", path: "live/market/prepare", body: {}, session, approvalFlow: { verifierHash } });
  expect(response.headers.get("Server-Timing")).not.toContain("id_bind");
  const prepared = await response.json(), ceremony = state.sessions[hash(session)].ceremony!;
  expect(state.challenges[hash(first)]).toBeUndefined();
  expect(state.challenges[hash(ceremony)].value).toBe("challenge-bound");
  const record = await readFlow(prepared.walletFlow.flowId, store);
  expect(record.hostedFlow).toMatchObject({ kind: "approval", verifierHash, submitRoute: "live/market/submit" });
  expect(authenticationOptions.parse(record.hostedFlow!.options)).toMatchObject({ challenge: "challenge-bound", allowCredentials: [{ type: "public-key", id: "credential" }] });
  expect(JSON.stringify(record.hostedFlow!.review)).not.toContain("private");
  // The flow carries the ceremony the grant now names.
  await completeApproval(prepared.walletFlow.flowId, { id: "credential" }, store);
  expect(vi.mocked(handleNear).mock.lastCall![0].cookies.get(CEREMONY)?.value).toBe(ceremony);
  // Refused by the rate limit, the save binds nothing.
  state.requests = Array(60).fill(Date.now());
  prepare();
  expect((await service({ operation: "request", path: "live/market/prepare", body: {}, session, approvalFlow: { verifierHash } })).ok).toBe(false);
  expect(state.sessions[hash(session)].ceremony).toBe(ceremony);
});
