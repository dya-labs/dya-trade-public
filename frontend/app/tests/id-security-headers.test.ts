// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../id/proxy";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ORIGIN", "https://id.example.test");
  vi.stubEnv("DYA_TERMINAL_ORIGIN", "https://app.example.test");
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "test-only-password");
  vi.stubEnv("PASSKEY_RP_ID", "id.example.test");
});
afterEach(() => vi.unstubAllEnvs());
function request(path: string, authenticated = true) {
  return new NextRequest(`https://id.example.test${path}`, { headers: {
    ...(authenticated ? { authorization: `Basic ${Buffer.from("tester:test-only-password").toString("base64")}` } : {}),
    "x-nonce": "attacker", "Content-Security-Policy": "script-src 'unsafe-inline'",
  } });
}
it("uses a fresh render nonce and limits scripts and connections in production", () => {
  const response = proxy(request("/"));
  const policy = response.headers.get("Content-Security-Policy")!;
  const nonce = /'nonce-([^']+)'/.exec(policy)![1];
  expect(nonce).not.toBe("attacker");
  expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
  expect(proxy(request("/")).headers.get("Content-Security-Policy")).not.toBe(policy);
  expect(policy.split(";").find(value => value.includes("script-src"))).not.toMatch(/unsafe-inline|unsafe-eval|https:/);
  expect(policy).toContain("connect-src 'self';");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'none'");
});
it("allows only the fixed Terminal and ID to embed flow pages", () => {
  const flow = proxy(request("/flow/request"));
  expect(flow.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self' https://app.example.test");
  expect(flow.headers.has("X-Frame-Options")).toBe(false);
  for (const path of ["/", "/api/near/state", "/flow-evil/request"]) {
    const response = proxy(request(path));
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  }
});
it("keeps browser protections on authentication failures", () => {
  const response = proxy(request("/flow/request", false));
  expect(response.status).toBe(401);
  expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  expect(response.headers.get("Permissions-Policy")).toContain("publickey-credentials-get=(self)");
});

it("allows validated fallback token images without allowing external scripts or other connections", () => {
  const policy = proxy(request("/")).headers.get("Content-Security-Policy")!;
  const images = policy.split(";").find(value => value.trim().startsWith("img-src"))!;
  expect(images).toContain("https://s2.coinmarketcap.com/static/img/coins/64x64/");
  expect(images.split(/\s+/)).not.toContain("https:");
  expect(policy).toContain("connect-src 'self';");
  expect(policy.split(";").find(value => value.includes("script-src"))).not.toContain("coinmarketcap");
});

it("keeps every API path behind the Basic gate", () => {
  for (const path of ["/api/near/state", "/api/service", "/api/flow/any"]) {
    expect(proxy(request(path, false)).status).toBe(401);
  }
});
