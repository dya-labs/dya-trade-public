// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import worker from "../worker";
import { handleWalletBridge, proxyWallet } from "../worker/wallet-bridge";
import { POST as confirmFlow } from "../../id/app/api/flow/[id]/route";
import { completeConnection, completeApproval } from "../../../backend/id/src/bridge/service";
import { readRequestText } from "../../../packages/wallet-contracts/src/http/request-validation";

// Only the app adapter is exercised; the ID service never runs.
vi.mock("../../../backend/id/src/bridge/service", () => ({ completeConnection: vi.fn(), completeApproval: vi.fn() }));
const fetcher = vi.fn();
const entries = [
  { name: "Terminal wallet proxy", origin: "http://localhost:3100", limit: 20000, run: (r: Request) => proxyWallet(r, "auth/logout") },
  { name: "Terminal connection", origin: "http://localhost:3100", limit: 5000, run: (r: Request) => handleWalletBridge(r, "flow") },
  { name: "Terminal analysis", origin: "http://localhost:3100", limit: 20000, run: (r: Request) => worker.fetch(new Request(new URL("/api/near/analysis/entry", r.url), r), { ASSETS: { fetch: fetcher } }) },
  { name: "ID approval adapter", origin: "http://localhost:3101", limit: 20000, run: (r: Request) => confirmFlow(new NextRequest(r), { params: Promise.resolve({ id: "synthetic" }) }) },
];
beforeEach(() => {
  vi.clearAllMocks();vi.stubGlobal("fetch", fetcher);fetcher.mockRejectedValue(new Error("Unexpected dependency request"));
  vi.stubEnv("DYA_ID_ORIGIN", "http://localhost:3101");vi.stubEnv("DYA_SERVICE_SECRET", "synthetic-boundary-secret");
  vi.stubEnv("PASSKEY_RP_ID", "localhost");vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "");
  vi.stubEnv("NEAR_AI_API_KEY", "synthetic-configured-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals(); });
function request(entry: typeof entries[number], body: string, type = "application/json", origin = entry.origin) {
  vi.stubEnv("APP_ORIGIN", entry.origin);
  return new Request(entry.origin + "/api/test", { method: "POST", headers: { origin, "content-type": type, "content-length": "1" }, body });
}
function untouched() { expect(fetcher).not.toHaveBeenCalled();expect(completeConnection).not.toHaveBeenCalled();expect(completeApproval).not.toHaveBeenCalled(); }
it.each(entries)("$name rejects JSON-lookalike media types before dependency calls", async entry => {
  expect((await entry.run(request(entry, '{"action":"connect"}', "application/jsonp"))).status).toBe(403);untouched();
});
it.each(entries)("$name enforces UTF-8 byte limits despite a false Content-Length", async entry => {
  const body = JSON.stringify({ action: "connect", padding: "😀".repeat(entry.limit / 4) });
  expect(body.length).toBeLessThan(entry.limit);expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(entry.limit);
  const response = await entry.run(request(entry, body));
  expect([400, 413]).toContain(response.status);expect((await response.json()).error).toBe("Request too large");untouched();
});
it.each(entries)("$name rejects cross-origin JSON before dependency calls", async entry => {
  expect((await entry.run(request(entry, '{"action":"connect"}', "application/json", "http://other.example"))).status).toBe(403);untouched();
});
it("cancels a chunked request at overflow without reading the remaining chunks", async () => {
  const cancel = vi.fn();let reads = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++;if (reads > 3) controller.close();else controller.enqueue(new Uint8Array(6)); }, cancel }, { highWaterMark: 0 });
  const request = new Request("http://localhost/", { method: "POST", body, duplex: "half" } as RequestInit);
  expect(await readRequestText(request, 10)).toBeNull();expect(reads).toBe(2);expect(cancel).toHaveBeenCalledOnce();
});
it("preserves split UTF-8 bytes at the exact allowed size", async () => {
  const bytes = new TextEncoder().encode("😀"), body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 2));controller.enqueue(bytes.slice(2));controller.close(); } });
  expect(await readRequestText(new Request("http://localhost/", { method: "POST", body, duplex: "half" } as RequestInit), 4)).toBe("😀");
});
