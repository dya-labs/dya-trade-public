// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDeploymentConfig } from "../../../backend/id/src/deployment/config";
import { checkInternalAccess } from "../../../backend/id/src/deployment/access";
import { getStore } from "../../../backend/id/src/near/repositories/store";

const password = "test-only-password-for-internal-access-12345";
const env = { APP_ORIGIN: "https://id.example.test", INTERNAL_ACCESS_PASSWORD: password };
afterEach(() => vi.unstubAllEnvs());

it("defaults to local development and validates fixed hosted origin and exact passkey domain", () => {
  expect(getDeploymentConfig({})).toMatchObject({ origin: "http://localhost:3101", rpId: "localhost", hosted: false, secure: false });
  expect(getDeploymentConfig(env)).toMatchObject({ origin: env.APP_ORIGIN, rpId: "id.example.test", hosted: true, secure: true, password });
  expect(getDeploymentConfig({ ...env, INTERNAL_ACCESS_PASSWORD: "" }).password).toBeUndefined();
  for (const invalid of [
    { VERCEL: "1" },
    { ...env, APP_ORIGIN: "http://id.example.test" },
    { ...env, APP_ORIGIN: "https://user:secret@id.example.test" },
    { ...env, APP_ORIGIN: "https://id.example.test/path" },
    { ...env, APP_ORIGIN: "https://id.example.test/?query=1" },
    { ...env, PASSKEY_RP_ID: "example.test" },
    { ...env, VERCEL: "1", APP_ORIGIN: "http://localhost:3100" },
  ]) expect(() => getDeploymentConfig(invalid)).toThrow();
});

it.each(["a", "short", "a password with spaces", "秘密:🔑"])("authenticates a non-empty password without length or character restrictions: %s", (value) => {
  const config = getDeploymentConfig({ ...env, INTERNAL_ACCESS_PASSWORD: value });
  const authorization = `Basic ${Buffer.from(`tester:${value}`).toString("base64")}`;
  expect(checkInternalAccess(new NextRequest(env.APP_ORIGIN, { headers: { authorization } }), config)).toBeNull();
  expect(checkInternalAccess(new NextRequest(env.APP_ORIGIN), config)?.status).toBe(401);
});

it("gates the page, API, and assets; rejects host spoofing even with valid credentials", () => {
  const config = getDeploymentConfig(env);
  const authorization = `Basic ${Buffer.from(`tester:${password}`).toString("base64")}`;
  for (const path of ["/", "/api/near/state", "/api/near/market", "/_next/static/chunk.js", "/tokens/near.svg"]) {
    expect(checkInternalAccess(new NextRequest(`${env.APP_ORIGIN}${path}`), config)?.status).toBe(401);
    expect(checkInternalAccess(new NextRequest(`${env.APP_ORIGIN}${path}`, { headers: { authorization } }), config)).toBeNull();
  }
  for (const value of ["Basic !!!", "Bearer anything", `Basic ${Buffer.from("attacker:" + password).toString("base64")}`]) {
    expect(checkInternalAccess(new NextRequest(env.APP_ORIGIN, { headers: { authorization: value } }), config)?.status).toBe(401);
  }
  expect(checkInternalAccess(new NextRequest(env.APP_ORIGIN, { headers: { authorization, host: "evil.test", "x-forwarded-host": "id.example.test" } }), config)?.status).toBe(403);
});

it("fails closed on Vercel with missing configuration and never falls back to SQLite", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("APP_ORIGIN", env.APP_ORIGIN);
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", password);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("TERMINAL_STORAGE", "postgres");
  await expect(getStore()).rejects.toThrow("DATABASE_URL is required");
});

it("ignores an ambient DATABASE_URL locally unless Postgres is explicitly selected", async () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3100");
  vi.stubEnv("PASSKEY_RP_ID", "");
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", "");
  vi.stubEnv("TERMINAL_STORAGE", "");
  vi.stubEnv("DATABASE_URL", "postgres://must-not-be-used");
  const local = { transaction: vi.fn() };
  const globalStore = globalThis as unknown as { nearStore?: unknown };
  const previous = globalStore.nearStore;
  globalStore.nearStore = local;
  try { expect(await getStore()).toBe(local); }
  finally { globalStore.nearStore = previous; }
});

it("rejects a hosted SQLite override", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("APP_ORIGIN", env.APP_ORIGIN);
  vi.stubEnv("PASSKEY_RP_ID", "");
  vi.stubEnv("INTERNAL_ACCESS_PASSWORD", password);
  vi.stubEnv("TERMINAL_STORAGE", "sqlite");
  await expect(getStore()).rejects.toThrow("Hosted storage must use Postgres");
});
