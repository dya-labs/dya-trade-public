import { createHash } from "node:crypto";
import { expect } from "vitest";
import { authenticator } from "./authenticator";

export type BridgeCall = (path: string, body: unknown, cookie?: string) => Promise<Response>;
/** Synthetic passkey + real cryptography; no provider or funded endpoint. */
export async function verifyBridge(origin: string, transport: BridgeCall) {
  const evidence: Record<string, unknown> = { syntheticAuthenticator: true, fundedOperations: false, startedAt: new Date().toISOString() };
  const metrics: Record<string, number | boolean | string>[] = [];
  const call: BridgeCall = async (path, body, cookie) => {
    const response = await transport(path, body, cookie);
    const raw = response.headers.get("x-dya-id-storage-metrics");
    if (raw) {
      const input = JSON.parse(raw) as Record<string, unknown>, safe: Record<string, number | boolean | string> = {};
      for (const key of ["status", "durationMs", "reservedStatements", "reservedUnits", "budgetLimit", "successfulStatements", "failedBatches", "rowsRead", "rowsWritten", "sqlDurationMs"]) {
        if (typeof input[key] === "number" && Number.isFinite(input[key])) safe[key] = input[key];
      }
      safe.budgetExhausted = input.budgetExhausted === true;
      safe.operation = path.startsWith("/api/flow/") ? "flow-confirmation" : path;
      metrics.push(safe);
    }
    return response;
  };
  const grants: string[] = [];
  let walletCookie = "";
  const service = (body: unknown) => call("/api/service", body);
  const cookie = (response: Response, name: string) => {
    const value = response.headers.getSetCookie().map(v => v.split(";")[0]).find(v => v.startsWith(`${name}=`));
    if (!value) throw new Error(`Missing ${name} cookie`);
    return value;
  };
  try {
    const key = authenticator(origin);
    const options = await call("/api/near/auth/register/options", {});
    expect(options.status).toBe(200);
    const registration = await call("/api/near/auth/register/verify", key.registration((await options.json()).challenge), cookie(options, "near_challenge"));
    expect(registration.status).toBe(200);
    walletCookie = cookie(registration, "near_session");
    const verifier = "v".repeat(43), verifierHash = createHash("sha256").update(verifier).digest("base64url");
    const connect = async (race = false) => {
      const created = await service({ operation: "flow", body: { action: "connect", verifierHash } });
      expect(created.status).toBe(200);
      const flow = await created.json();
      const responses = race
        ? await Promise.all([call(`/api/flow/${flow.flowId}`, { action: "connect" }, walletCookie), call(`/api/flow/${flow.flowId}`, { action: "connect" }, walletCookie)])
        : [await call(`/api/flow/${flow.flowId}`, { action: "connect" }, walletCookie)];
      if (race) { evidence.connectionRaceStatuses = responses.map(r => r.status); expect(responses.map(r => r.status).sort()).toEqual([200, 400]); }
      const complete = responses.find(r => r.status === 200)!;
      expect(complete).toBeDefined();
      const { code } = await complete.json();
      const exchange = { operation: "exchange", flowId: flow.flowId, code, verifier };
      if (race) {
        expect((await service({ ...exchange, code: "wrong" })).status).toBe(400);
        expect((await service({ ...exchange, verifier: "wrong" })).status).toBe(400);
        evidence.invalidCodeAndVerifierRejected = true;
      }
      const exchanges = race ? await Promise.all([service(exchange), service(exchange)]) : [await service(exchange)];
      if (race) { evidence.exchangeRaceStatuses = exchanges.map(r => r.status); expect(exchanges.map(r => r.status).sort()).toEqual([200, 400]); }
      const success = exchanges.find(r => r.status === 200)!;
      expect(success).toBeDefined();
      const grant = (await success.json()).session as string;
      expect(typeof grant).toBe("string");
      grants.push(grant);
      return grant;
    };
    const grant = await connect(true);
    const state = await service({ operation: "request", path: "state", session: grant });
    expect(state.status).toBe(200); expect((await state.json()).account).not.toBeNull();
    expect(state.headers.has("set-cookie")).toBe(false);
    const other = await connect();
    const prepared = await service({ operation: "request", path: "backup/authorize/options", body: {}, session: grant });
    expect(prepared.status).toBe(200);
    const challenge = (await prepared.json()).challenge as string;
    const approval = await service({ operation: "flow", session: grant, body: { action: "approval", verifierHash, challenge } });
    expect(approval.status).toBe(200);
    const flow = await approval.json();
    const assertion = key.assertion(challenge, 1);
    const completed = await Promise.all([call(`/api/flow/${flow.flowId}`, { action: "approve", assertion }, walletCookie), call(`/api/flow/${flow.flowId}`, { action: "approve", assertion }, walletCookie)]);
    evidence.approvalRaceStatuses = completed.map(r => r.status);
    expect(completed.map(r => r.status).sort()).toEqual([200, 400]);
    const result = await completed.find(r => r.status === 200)!.json();
    expect(result.status).toBe(200); expect(result.body).toEqual({ ok: true });
    const receipt = { operation: "receipt", flowId: flow.flowId, session: grant, path: "backup/authorize/verify" };
    expect((await service(receipt)).status).toBe(200);
    expect((await service({ ...receipt, session: other })).status).toBe(400);
    expect((await service({ ...receipt, path: "backup/test/verify" })).status).toBe(400);
    expect((await service({ operation: "request", session: grant, path: "backup/authorize/verify", body: assertion })).status).toBe(400);
    evidence.receiptOwnershipAndRouteEnforced = true;
    evidence.directSignatureSubmissionRejected = true;
    expect((await service({ operation: "request", path: "connection/revoke", session: grant, body: {} })).status).toBe(200);
    grants.splice(grants.indexOf(grant), 1); // Already revoked; do not revoke it again during cleanup.
    const revoked = await service({ operation: "request", path: "state", session: grant });
    expect(revoked.status).toBe(200); expect((await revoked.json()).account).toBeNull();
    expect((await service(receipt)).status).toBe(400);
    evidence.grantRevocationEnforced = true;
    evidence.result = "passed";
  } finally {
    for (const session of grants) {
      try { if ((await service({ operation: "request", path: "connection/revoke", session, body: {} })).status !== 200) evidence.cleanupFailed = true; }
      catch { evidence.cleanupFailed = true; }
    }
    if (walletCookie) {
      try { if ((await call("/api/near/auth/logout", {}, walletCookie)).status !== 200) evidence.cleanupFailed = true; }
      catch { evidence.cleanupFailed = true; }
    }
    evidence.finishedAt = new Date().toISOString(); evidence.result ??= "failed";
    evidence.storageMetrics = metrics;
    console.info("id.d1.bridge.verification", JSON.stringify(evidence));
  }
  return evidence;
}
