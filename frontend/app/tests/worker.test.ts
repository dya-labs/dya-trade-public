// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../worker";

const origin = "https://app.example.test";
const password = "test-only-password";
const authorization = `Basic ${Buffer.from(`tester:${password}`).toString("base64")}`;
const assets = { fetch: vi.fn(async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })) };
const fetcher = vi.fn();
const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), { ASSETS: assets });

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", password);
  vi.stubEnv("DYA_ID_ORIGIN", "https://id.example.test");
  vi.stubEnv("DYA_SERVICE_SECRET", "s".repeat(32));
  vi.stubGlobal("fetch", fetcher);
  assets.fetch.mockClear();
  fetcher.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("returns truthful Jev configuration failure before any wallet or market fetch", async () => {
  vi.stubEnv("NEAR_AI_API_KEY", "");
  fetcher.mockRejectedValue(new Error("Synthetic wallet service offline"));
  const response = await call("/api/near/analysis/entry", { method: "POST", headers: { authorization, origin, "content-type": "application/json" }, body: JSON.stringify({ assetId: "nep141:wrap.near" }) });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "Jev is not configured.", code: "JEV_IS_NOT_CONFIGURED", requestId: expect.any(String) });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetcher).not.toHaveBeenCalled();
});

it("gates the page, deep links, assets, and APIs before serving anything", async () => {
  for (const path of ["/", "/trade/near", "/assets/index.js", "/favicon.svg", "/api/near/session", "/api/wallet/flow"]) {
    const response = await call(path);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  }
  expect(assets.fetch).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("serves the SPA to authenticated testers and rejects other hosts", async () => {
  expect(await (await call("/trade/near", { headers: { authorization } })).text()).toBe("<!doctype html>");
  expect(assets.fetch).toHaveBeenCalledTimes(1);
  const spoofed = await worker.fetch(new Request("https://evil.example.test/", { headers: { authorization, "x-forwarded-host": new URL(origin).host } }), { ASSETS: assets });
  expect(spoofed.status).toBe(403);
});

it("serves the app without a gate when no tester password is configured", async () => {
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "");
  const response = await call("/");
  expect(response.status).toBe(200);
  expect(assets.fetch).toHaveBeenCalledOnce();
});

it("answers unknown API paths and wrong methods itself instead of falling back to the SPA", async () => {
  const headers = { authorization };
  expect((await call("/api/unknown", { headers })).status).toBe(404);
  expect((await call("/api/near/", { headers })).status).toBe(404);
  expect((await call("/api/wallet/flow", { method: "DELETE", headers })).status).toBe(405);
  expect(assets.fetch).not.toHaveBeenCalled();
});

it("proxies DYA ID requests with decoded catch-all paths and the query string", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ account: null }));
  const response = await call("/api/near/account/state?fresh=1", { headers: { authorization, cookie: "dya_wallet_grant_v1=grant" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe("https://id.example.test/api/service");
  expect(JSON.parse(init.body)).toEqual({ operation: "request", path: "account/state?fresh=1", session: "grant" });
});

it.each([
  ["wrong password", `Basic ${Buffer.from("tester:incorrect").toString("base64")}`],
  ["wrong username", `Basic ${Buffer.from(`someone:${password}`).toString("base64")}`],
  ["wrong scheme", "Bearer test-token"],
  ["malformed encoding", "Basic %%%"],
  ["oversized credential", `Basic ${"A".repeat(4096)}`],
])("rejects %s across page, asset and API routes without reaching dependencies", async (_label, rejectedAuthorization) => {
  for (const path of ["/", "/assets/app.js", "/api/near/session"]) {
    const response = await call(path, { headers: { authorization: rejectedAuthorization } });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain(password);
  }
  expect(assets.fetch).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps malformed and bare API paths out of the SPA fallback", async () => {
  for (const path of ["/api", "/api/", "/api/near/%ZZ", "/api/wallet/%ZZ"]) {
    const response = await call(path, { headers: { authorization } });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(assets.fetch).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["null", "[]", "42", '"NEAR"', "{", ""])("rejects invalid analysis envelope %s before external dependencies", async body => {
  vi.stubEnv("NEAR_AI_API_KEY", "synthetic-configured-key");
  fetcher.mockRejectedValue(new Error("Unexpected dependency access"));
  const response = await call("/api/near/analysis/entry", { method: "POST", headers: { authorization, origin, "content-type": "application/json" }, body });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "Invalid request", requestId: expect.any(String) });
  expect(fetcher).not.toHaveBeenCalled();expect(assets.fetch).not.toHaveBeenCalled();
});
