import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleWalletBridge, proxyWallet } from "../worker/wallet-bridge";
const fetcher = vi.fn();
beforeEach(() => { vi.stubEnv("APP_ORIGIN", "http://localhost:3100"); vi.stubEnv("DYA_ID_ORIGIN", "http://localhost:3101"); vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function request(path: string, body: unknown, cookies = "") { return new Request(`http://localhost:3100/api/wallet/${path}`, { method: "POST", headers: { origin: "http://localhost:3100", "content-type": "application/json", cookie: cookies }, body: JSON.stringify(body) }); }
function cookie(response: Response, name: string) {
  const value = response.headers.getSetCookie().find(item => item.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1);
  return value === undefined ? undefined : decodeURIComponent(value);
}
it.each([301, 302, 303, 307, 308])("rejects upstream %s redirects without following or forwarding their content", async (status) => {
  fetcher.mockResolvedValueOnce(new Response("untrusted redirect content", { status, headers: { location: "https://other.example/service" } }));
  const response = await proxyWallet(new Request("http://localhost:3100/api/auth/session"), "auth/session");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "DYA ID is unavailable. Check the wallet service and try again.", requestId: expect.any(String) });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
});
it("binds hosted callbacks to the browser flow and stores only the exchanged app grant", async () => {
  const flowId = "f".repeat(43);
  fetcher.mockResolvedValueOnce(Response.json({ flowId, url: `http://localhost:3101/flow/${flowId}`, expires: Date.now() + 60000 }));
  const created = await handleWalletBridge(request("flow", { action: "connect" }), "flow");
  const pending = cookie(created, "dya_wallet_flow_v1")!;
  const callback = new Request(`http://localhost:3100/api/wallet/callback?flowId=${flowId}&code=code`, { headers: { cookie: `dya_wallet_flow_v1=${encodeURIComponent(pending)}` } });
  fetcher.mockResolvedValueOnce(Response.json({ session: "app-grant" }));
  const result = await handleWalletBridge(callback, "callback");
  expect(result.status).toBe(303); expect(result.headers.get("location")).toBe("http://localhost:3100/");
  expect(cookie(result, "dya_wallet_grant_v1")).toBe("app-grant");
  expect(result.headers.getSetCookie().find(item => item.startsWith("dya_wallet_grant_v1="))).toContain("HttpOnly");
  expect(cookie(result, "dya_wallet_flow_v1")).toBe("");
  const sent = JSON.parse(fetcher.mock.calls[1][1].body); expect(sent.operation).toBe("exchange"); expect(sent.verifier).toHaveLength(43);
});
it("rejects mismatched callbacks before contacting the service", async () => {
  const response = await handleWalletBridge(new Request("http://localhost:3100/api/wallet/callback?flowId=other&code=code", { headers: { cookie: `dya_wallet_flow_v1=${encodeURIComponent(JSON.stringify({ id: "original", action: "connect" }))}` } }), "callback");
  expect(response.status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it("disconnect revokes the app grant and clears its cookie", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ ok: true }));
  const response = await handleWalletBridge(request("disconnect", {}, "dya_wallet_grant_v1=app-grant"), "disconnect");
  expect(response.status).toBe(200);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ operation: "request", path: "connection/revoke", session: "app-grant" });
  expect(cookie(response, "dya_wallet_grant_v1")).toBe("");
});
it("converts approval receipts into grant-bound result requests and does not forward wallet cookies", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ operation: { state: "submitted" } }, { headers: { "set-cookie": "near_session=wallet-secret" } }));
  const response = await proxyWallet(request("unused", { id: "receipt", dyaApproval: "receipt" }, "dya_wallet_grant_v1=grant"), "funding/submit");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ operation: "receipt", path: "funding/submit", session: "grant", flowId: "receipt" });
  expect(response.headers.get("set-cookie")).toBeNull(); expect(response.status).toBe(200);
});
