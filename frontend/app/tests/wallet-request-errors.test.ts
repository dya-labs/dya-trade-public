// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleWalletBridge, proxyWallet } from "../worker/wallet-bridge";
const fetcher = vi.fn(), writes = vi.fn();
const entries = [
  { name: "Terminal wallet proxy", origin: "http://localhost:3100", run: (r: Request) => proxyWallet(r, "auth/logout") },
  { name: "Terminal connection bridge", origin: "http://localhost:3100", run: (r: Request) => handleWalletBridge(r, "flow") },
];
beforeEach(() => {
  vi.clearAllMocks();vi.stubGlobal("fetch", fetcher);fetcher.mockResolvedValue(Response.json({ ok: true }));
  vi.stubEnv("DYA_ID_ORIGIN", "http://localhost:3101");vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals(); });
function request(origin: string, body: string) {
  vi.stubEnv("APP_ORIGIN", origin);
  return new Request(origin + "/api/test", { method: "POST", headers: { origin, "content-type": "application/json", cookie: "dya_wallet_grant_v1=synthetic-grant" }, body });
}
for (const entry of entries) {
  it.each(["{", "", "null", "[]", "42", '"text"'])(`${entry.name} rejects malformed/nonobject JSON %s before side effects`, async body => {
    const response = await entry.run(request(entry.origin, body));
    expect(response.status).toBe(400);const data = await response.json();
    expect(data.error).toBe("Invalid request");expect(data.requestId).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(writes).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
}
