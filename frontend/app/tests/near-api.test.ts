import { approvedTestTokens } from "./fixtures/token-policy";
import { DEFAULT_PAIR } from "../../../packages/wallet-contracts/src/domain/catalog";
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { z } from "zod";
import { snapshot, registrationOptions, authenticationOptions, signingCheck, balances } from "@/lib/near/http/schemas/account";
import { ok } from "@/lib/near/http/schemas/common";
import { order } from "@/lib/near/http/schemas/trading";
import { NextRequest } from "next/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { handleNear as handleWallet } from "../../../backend/id/src/near/http/api";
import { createMarketEntryPlan } from "@/lib/analysis/market-entry-analysis";
const handleNear: typeof handleWallet = (request, path, store, simulator, balances) => handleWallet(request, path, store, simulator, balances, createMarketEntryPlan);
import { approvedTestNetworks } from "./fixtures/network-policy";
import { type StateStore, hash } from "../../../backend/id/src/near/repositories/store";
import { Store } from "../../../backend/id/src/near/repositories/sqlite-store";
import { simulateProbe } from "../../../backend/id/src/near/auth/intents";
import * as confidentialProvider from "../../../backend/id/src/near/providers/confidential";
import { ASSETS } from "@/lib/near/domain/assets";
import { verifyAssertion } from "../../../backend/id/src/near/auth/passkeys";
import { readBalances } from "../../../backend/id/src/near/providers/live";


const apiCatalog = () => [
  { ...DEFAULT_PAIR.base, coingeckoId: "near" },
  { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" },
  { blockchain: "bsc", symbol: "USDC", assetId: "nep141:bsc-usdc.omft.near", decimals: 6 },
];
vi.mock("../../../backend/id/src/near/providers/catalog", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../backend/id/src/near/providers/catalog")>();
  return { ...actual, readCatalog: async () => apiCatalog(), resolvePair: (body: Record<string, unknown>) => actual.resolvePair(body, async () => apiCatalog()) };
});

let origin = "http://localhost:3100";
let asyncStorage = false;
const testerPassword = "test-only-password-for-hosted-passkeys-12345";
let store: Store;
beforeEach(() => {
  vi.stubEnv("CONFIDENTIAL_SESSION_KEY", "11".repeat(32));
  store = new Store(":memory:");
  store.transaction(s => { s.networks = Object.fromEntries(approvedTestNetworks.map(n => [n.id, n])); s.tokens = Object.fromEntries(approvedTestTokens(apiCatalog()).map(t => [t.id,t])); });
});
afterEach(() => { vi.restoreAllMocks(); store.close(); vi.unstubAllEnvs(); });
function browser(simulator: typeof simulateProbe = simulateProbe, balanceReader: typeof readBalances = readBalances) {
  const jar: Record<string, string> = {};
  return {
    jar,
    async call(
      path: string,
      body?: unknown,
      overrides: Record<string, string> = {},
    ) {
      const req = new NextRequest(`${origin}/api/near/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          host: new URL(origin).host,
          ...(origin.startsWith("https:") ? { authorization: `Basic ${Buffer.from(`tester:${testerPassword}`).toString("base64")}` } : {}),
          origin,
          "content-type": "application/json",
          cookie: Object.entries(jar)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
          ...overrides,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const delayed: StateStore = { read: async fn => store.read(fn), transaction: async fn => { await new Promise(resolve => setTimeout(resolve, 1)); return store.transaction(fn); } };
      const res = await handleNear(req, path.split("/"), asyncStorage ? delayed : store, simulator, balanceReader);
      if (origin.startsWith("https:")) for (const c of res.cookies.getAll()) expect(c.secure).toBe(true);
      for (const c of res.cookies.getAll()) jar[c.name] = c.value;
      const data = await res.json();
      // Exercise browser contracts against actual route responses (synthetic authenticator, local storage).
      const contracts: Record<string, z.ZodType> = {
        state: snapshot, "live/balances": balances, "live/orders": z.object({ orders: z.array(order) }),
        "auth/register/options": registrationOptions, "auth/login/options": authenticationOptions,
        "backup/register/options": registrationOptions, "backup/authorize/options": authenticationOptions,
        "backup/test/options": authenticationOptions,
        "intents/prepare": z.object({ options: authenticationOptions }), "intents/verify": z.object({ result: signingCheck }),
      };
      const contract = contracts[path] ?? (path.endsWith("/verify") || path === "auth/logout" ? ok : undefined);
      if (res.ok && contract) contract.parse(data);
      return { status: res.status, data };
    },
  };
}
// A synthetic authenticator with real P-256 signatures. No verification functions are mocked.
function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]),
  );
  const rp = createHash("sha256").update(new URL(origin).hostname).digest();
  const client = (challenge: string, type: string, responseOrigin = origin, topOrigin?: string) =>
    Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: responseOrigin,
        crossOrigin: Boolean(topOrigin),
        ...(topOrigin ? { topOrigin } : {}),
      }),
    );
  return {
    id: id.toString("base64url"),
    registration(challenge: string, responseOrigin = origin) {
      const size = Buffer.alloc(2);
      size.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        rp,
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        size,
        id,
        cose,
      ]);
      const att = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ["fmt", "none"],
          ["authData", new Uint8Array(authData)],
          ["attStmt", new Map()],
        ]),
      );
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: client(
            challenge,
            "webauthn.create",
            responseOrigin,
          ).toString("base64url"),
          attestationObject: Buffer.from(att).toString("base64url"),
          transports: ["internal"],
        },
      };
    },
    assertion(
      challenge: string,
      counter: number,
      responseOrigin = origin,
      uv = true,
      topOrigin?: string,
    ) {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([rp, Buffer.from([uv ? 5 : 1]), count]);
      const data = client(challenge, "webauthn.get", responseOrigin, topOrigin);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, createHash("sha256").update(data).digest()]),
        privateKey,
      );
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: data.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      };
    },
  };
}
async function register(
  b: ReturnType<typeof browser>,
  a: ReturnType<typeof authenticator>,
) {
  const options = await b.call("auth/register/options", {});
  const res = await b.call(
    "auth/register/verify",
    a.registration(options.data.challenge),
  );
  expect(res.status, JSON.stringify(res.data)).toBe(200);
}
describe.each([
  { url: "http://localhost:3100", asynchronous: false },
  { url: "https://id.example.test", asynchronous: true },
])("passkeys at $url", ({ url, asynchronous }) => {
  beforeEach(() => {
    origin = url; asyncStorage = asynchronous;
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("APP_ORIGIN", url);
    vi.stubEnv("PASSKEY_RP_ID", "");
    vi.stubEnv("INTERNAL_ACCESS_PASSWORD", asynchronous ? testerPassword : "");
  });
describe("local passkey and order API", () => {
  it("uses the account name for the passkey and retains it on later sign-in", async () => {
    const b = browser(), a = authenticator();
    const options = await b.call("auth/register/options", { name: "  PersonalWallet  " });
    expect(options.status).toBe(200);
    expect(options.data.user).toMatchObject({ name: "PersonalWallet", displayName: "PersonalWallet" });
    const registered = await b.call("auth/register/verify", { ...a.registration(options.data.challenge), name: "Injected replacement" });
    expect(registered.status).toBe(200);
    expect(registered.data.session.account.name).toBe("PersonalWallet");
    const identity = registered.data.session.account.intentsIdentity;
    await b.call("auth/logout", {});
    expect((await b.call("state")).data.account).toBeNull();
    const login = await b.call("auth/login/options", {});
    const signedIn = await b.call("auth/login/verify", a.assertion(login.data.challenge, 1));
    expect(signedIn.status).toBe(200);
    expect(signedIn.data.session.account.name).toBe("PersonalWallet");
    expect(signedIn.data.session.account.intentsIdentity).toEqual(identity);
  });
  it.each(["", "   ", "x".repeat(65), "bad\u0000name", "two words", "two\twords", 123, null])("rejects an invalid private name: %j", async name => {
    const b = browser();
    expect((await b.call("auth/register/options", { name })).status).toBe(400);
    expect(store.read(s => Object.keys(s.accounts))).toHaveLength(0);
    expect(store.read(s => Object.keys(s.challenges))).toHaveLength(0);
  });
  it("accepts signed iframe assertions only from the configured Terminal top origin", async () => {
    const terminal = asynchronous ? "https://terminal.example.test" : "http://localhost:3110";
    vi.stubEnv("DYA_TERMINAL_ORIGIN", terminal);
    const b = browser(), a = authenticator();
    await register(b, a);
    const account = store.read(s => Object.values(s.accounts)[0]);
    const assertion = (topOrigin?: string) => a.assertion("challenge", 1, origin, true, topOrigin) as Parameters<typeof verifyAssertion>[1];
    await expect(verifyAssertion(account, assertion(terminal), "challenge")).resolves.toBe(1);
    await expect(verifyAssertion(account, assertion(), "challenge")).resolves.toBe(1);
    await expect(verifyAssertion(account, assertion("https://untrusted.example"), "challenge")).rejects.toThrow("top origin");
  });

  it("verifies a protocol signing probe and rejects replay without changing account identity", async () => {
    let signedCount = 0;
    const mockSimulator: typeof simulateProbe = async (signed = []) => {
      signedCount += signed.length;
      if (signed.length)
        expect(JSON.parse(signed[0].payload).intents).toEqual([]);
      return {
        blockHeight: 123,
        output: { state: { current_salt: "252812b3" }, intents_executed: [] },
      };
    };
    const b = browser(mockSimulator),
      a = authenticator();
    await register(b, a);
    const before = (await b.call("state")).data.account;
    expect(before.intentsIdentity.accountId).toMatch(/^0x[0-9a-f]{40}$/);
    const prepared = await b.call("intents/prepare", {});
    expect(prepared.status).toBe(200);
    const assertion = a.assertion(prepared.data.options.challenge, 1);
    const result = await b.call("intents/verify", assertion);
    expect(result.status).toBe(200);
    expect(result.data.result.status).toBe("verified");
    expect(signedCount).toBe(1);
    expect((await b.call("state")).data.account.id).toBe(before.id);
    expect((await b.call("intents/verify", assertion)).status).toBe(400);
    expect(signedCount).toBe(1);
  });
  it("never reports verifier success when the RPC fails", async () => {
    const b = browser(async (signed = []) => {
        if (signed.length) throw new Error("offline");
        return {
          blockHeight: 123,
          output: { state: { current_salt: "252812b3" }, intents_executed: [] },
        };
      }),
      a = authenticator();
    await register(b, a);
    const prepared = await b.call("intents/prepare", {});
    const result = await b.call(
      "intents/verify",
      a.assertion(prepared.data.options.challenge, 1),
    );
    expect(result.data.result.status).toBe("unavailable");
    expect((await b.call("state")).data.account.signingCheck.status).toBe(
      "unavailable",
    );
  });



  it("uses one real passkey assertion for app login and private access, without leaking provider tokens", async () => {
    const provider = vi.spyOn(confidentialProvider, "authenticateConfidential").mockResolvedValue({ accessToken: "secret-access", refreshToken: "secret-refresh", expiresIn: 600, refreshExpiresIn: 3600 });
    vi.spyOn(confidentialProvider, "readConfidentialBalances").mockResolvedValue({ balances: [] });
    const simulator = vi.fn(async () => ({ output: { state: { current_salt: "12345678" }, intents_executed: [] }, blockHeight: 1 }));
    const b = browser(simulator), a = authenticator();
    await register(b, a);
    const credentialId = store.read(s => Object.values(s.accounts)[0].credentialId);
    await b.call("auth/logout", {});
    const options = await b.call("auth/login/options", { credentialId });
    expect(options.data.allowCredentials[0].id).toBe(credentialId);
    const signed = a.assertion(options.data.challenge, 1);
    const result = await b.call("auth/login/verify", signed);
    expect(result.data).toMatchObject({ ok: true, confidentialUnlocked: true });
    // The returned session is what `state` reports, so clients skip that request.
    expect(result.data.session).toEqual((await b.call("state")).data);
    expect(JSON.stringify(result.data)).not.toContain("secret");
    expect(provider).toHaveBeenCalledTimes(1);
    const proof = provider.mock.calls[0][0];
    if (proof.standard !== "webauthn") throw new Error("Expected passkey ownership proof");
    expect(createHash("sha256").update(proof.payload).digest("base64url")).toBe(options.data.challenge);
    expect(proof.client_data_json).toBe(Buffer.from(signed.response.clientDataJSON, "base64url").toString());
    expect(JSON.parse(proof.payload).intents).toEqual([]);
    expect((await b.call("confidential/balances", {})).data).toEqual({ balances: [] });
    expect((await b.call("auth/login/verify", signed)).status).toBe(400);
    await b.call("auth/logout", {});
    expect((await b.call("state")).data.account).toBeNull();
  });
  it("fails combined sign-in closed if private authentication fails", async () => {
    vi.spyOn(confidentialProvider, "authenticateConfidential").mockRejectedValue(new Error("Private authentication unavailable"));
    const b = browser(async () => ({ output: { state: { current_salt: "12345678" }, intents_executed: [] }, blockHeight: 1 })), a = authenticator();
    await register(b, a);
    const credentialId = store.read(s => Object.values(s.accounts)[0].credentialId);
    await b.call("auth/logout", {});
    const options = await b.call("auth/login/options", { credentialId });
    expect((await b.call("auth/login/verify", a.assertion(options.data.challenge, 1))).status).toBe(400);
    expect((await b.call("state")).data.account).toBeNull();
  });
  it("does not authorize an account from its credential hint or another account's assertion", async () => {
    const provider = vi.spyOn(confidentialProvider, "authenticateConfidential");
    const b = browser(async () => ({ output: { state: { current_salt: "12345678" }, intents_executed: [] }, blockHeight: 1 })), a = authenticator(), other = authenticator();
    await register(b, a);
    const credentialId = store.read(s => Object.values(s.accounts)[0].credentialId);
    await b.call("auth/logout", {});
    await register(b, other);
    await b.call("auth/logout", {});
    const options = await b.call("auth/login/options", { credentialId });
    expect((await b.call("auth/login/verify", other.assertion(options.data.challenge, 1))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    expect((await b.call("state")).data.account).toBeNull();
  });
  it("rejects challenge replay, invalid signatures, wrong origins, and missing user verification", async () => {
    const b = browser(),
      a = authenticator();
    await register(b, a);
    await b.call("auth/logout", {});
    const options = await b.call("auth/login/options", {});
    const signed = a.assertion(options.data.challenge, 1);
    expect((await b.call("auth/login/verify", signed)).status).toBe(200);
    expect((await b.call("auth/login/verify", signed)).status).toBe(400);
    for (const invalid of ["origin", "uv", "signature"]) {
      const opt = await b.call("auth/login/options", {});
      const assertion = a.assertion(
        opt.data.challenge,
        2,
        invalid === "origin" ? "https://evil.example" : origin,
        invalid !== "uv",
      );
      if (invalid === "signature")
        assertion.response.signature = randomBytes(70).toString("base64url");
      expect((await b.call("auth/login/verify", assertion)).status).toBe(400);
    }
  });
  it("accepts only one simultaneous use of a signed login challenge", async () => {
    const b = browser(), a = authenticator();
    await register(b, a);
    await b.call("auth/logout", {});
    const options = await b.call("auth/login/options", {});
    const signed = a.assertion(options.data.challenge, 1);
    const results = await Promise.all([b.call("auth/login/verify", signed), b.call("auth/login/verify", signed)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
  });
  it("rejects expired challenges and sessions", async () => {
    const b = browser(),
      a = authenticator();
    await register(b, a);
    store.transaction((s) => {
      s.sessions[hash(b.jar.near_session)].expires = 0;
    });
    expect((await b.call("state")).data.account).toBeNull();
    const options = await b.call("auth/login/options", {});
    store.transaction((s) => {
      s.challenges[hash(b.jar.near_challenge)].expires = 0;
    });
    expect(
      (
        await b.call(
          "auth/login/verify",
          a.assertion(options.data.challenge, 1),
        )
      ).status,
    ).toBe(400);
  });
  it("blocks anonymous orders, cross-origin mutations and DNS rebinding hosts", async () => {
    const b = browser();
    expect((await b.call("live/orders/prepare", {})).status).toBe(400);
    expect(
      (await b.call("auth/register/options", {}, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(
      (await b.call("state", undefined, { host: "evil.example:3100" })).status,
    ).toBe(403);
  });




});


describe("read-only live routes", () => {
  it("saves a provider deposit quote and refreshes its status by owned ID", async () => {
    const b = browser();
    await register(b, authenticator());
    const accountId = (await b.call("state")).data.account.intentsIdentity.accountId;
    const wallet = "0x" + "b".repeat(40);
    store.transaction(s => { s.networks!.bsc = { ...s.networks!.bsc, addressKind: "evm", evmChainId: 56 }; s.accessRecords ??= {}; s.accessRecords["refund:bsc"] = { kind: "refund-setting", id: "refund:bsc", networkId: "bsc", chainId: 56, address: "0x" + "d".repeat(40), revision: 1, updatedAt: 0, updatedBy: "operator" }; });
    const previousKey = process.env.ONE_CLICK_JWT;
    process.env.ONE_CLICK_JWT = "test-key";
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/tokens")) return Response.json([{ blockchain: "bsc", symbol: "USDC", assetId: "nep141:bsc-usdc.omft.near", decimals: 6 }]);
      if (String(url).includes("/status?")) return Response.json({ status: "SUCCESS", updatedAt: new Date().toISOString() });
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({ depositType: "ORIGIN_CHAIN", recipient: accountId, swapType: "FLEX_INPUT", refundTo: "0x" + "d".repeat(40) });
      return Response.json({ quoteRequest: request, quote: { minAmountIn: "990000", amountIn: "1000000", amountInFormatted: "1", amountOut: "990000", amountOutFormatted: "0.99", minAmountOut: "980000", depositAddress: "0x" + "c".repeat(40), deadline: new Date(Date.now() + 600000).toISOString() }, correlationId: "quote-id", signature: "sig" });
    });
    try {
      const created = await b.call("transfers/preview", { direction: "deposit", asset: "USDC", wallet, amount: "1" });
      expect(created.status).toBe(200);
      expect(typeof created.data.id).toBe("string");
      expect(created.data.refundTo).toBe("0x" + "d".repeat(40));
      store.transaction(s => { const setting = s.accessRecords!["refund:bsc"]; if (setting.kind === "refund-setting") { setting.address = "0x" + "e".repeat(40); setting.revision++; } });
      expect((await b.call("transfers/deposits")).data.deposits[0].quote.refundTo).toBe("0x" + "d".repeat(40));
      expect((await b.call("transfers/deposits")).data.deposits).toMatchObject([{ id: created.data.id, status: "PENDING_DEPOSIT" }]);
      const updated = await b.call("transfers/deposit-status", { id: created.data.id });
      expect(updated.data.providerStatus).toBe("SUCCESS");
      expect((await b.call("transfers/deposits")).data.deposits[0].status).toBe("SUCCESS");
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      fetcher.mockRestore();
      if (previousKey === undefined) delete process.env.ONE_CLICK_JWT;
      else process.env.ONE_CLICK_JWT = previousKey;
    }
  });
  it("persists deposit history and scopes it to the signed-in account", async () => {
    const a = browser(), b = browser();
    await register(a, authenticator());
    await register(b, authenticator());
    const ownerId = store.transaction(s => Object.values(s.accounts)[0].id);
    store.transaction(s => {
      s.deposits = { deposit1: {
        id: "deposit1", ownerId, createdAt: 1, updatedAt: 1, status: "PROCESSING",
        quote: { confidentiality: "advanced", direction: "deposit", sourceChain: "BSC", asset: "USDC", amount: "1", depositAddress: "0x" + "a".repeat(40) } as NonNullable<typeof s.deposits>[string]["quote"],
      } };
    });
    expect((await a.call("transfers/deposits")).data.deposits).toMatchObject([{ id: "deposit1", status: "PROCESSING" }]);
    expect((await b.call("transfers/deposits")).data.deposits).toEqual([]);
  });
  it("serves withdrawal history with GET for the current session", async () => {
    const b = browser();
    expect((await b.call("transfers/withdrawals")).status).toBe(400);
    await register(b, authenticator());
    expect(await b.call("transfers/withdrawals")).toEqual({ status: 200, data: { withdrawals: [] } });
    expect((await b.call("transfers/withdrawals", {})).status).toBe(404);
  });
  it("binds balance reads and preview recipients to the authenticated passkey and blocks submission", async () => {
    const queried: string[] = [];
    const b = browser(simulateProbe, async accountId => {
      queried.push(accountId);
      return { accountId, blockHeight: 123, checkedAt: Date.now(), assets: ASSETS.map(a => ({ ...a, raw: "0", amount: "0" })) };
    });
    expect((await b.call("live/balances")).status).toBe(400);
    expect(queried).toHaveLength(0);
    await register(b, authenticator());
    const before = (await b.call("state")).data.account;
    const balance = await b.call("live/balances?account_id=attacker.near");
    expect(balance.status).toBe(404);
    expect((await b.call("live/balances")).data.accountId).toBe(before.intentsIdentity.accountId);
    const p = await b.call("live/preview", { side: "buy", quantity: "1", price: "4", expiryHours: 24, accountId: "attacker.near", recipient: "attacker.near" });
    expect(p.status).toBe(200);
    expect(p.data.request.data.attributes).toMatchObject({ recipient: before.intentsIdentity.accountId, confidentiality: "advanced", depositType: "CONFIDENTIAL_INTENTS" });
    const market = await b.call("live/preview", { orderType: "market", side: "buy", quantity: "1" });
    expect(market.status).toBe(400);
    // Configuration problems answer with a reference, never the missing credential's name.
    expect(market.data.error).toBe(`Something went wrong. Reference: ${market.data.requestId}`);
    expect(JSON.stringify(market.data)).not.toContain("ONE_CLICK_JWT");
    expect((await b.call("live/orders", {})).status).toBe(404);
    expect((await b.call("live/orders/cancel", {})).status).toBe(401);
    expect((await b.call("state")).data.account.id).toBe(before.id);
    expect(queried.every(id => id === before.intentsIdentity.accountId)).toBe(true);
  });

});

describe("persistent real order ownership", () => {
  it("retains known creation rejections and never reconciles or recreates them on retry", async () => {
    const { OrderService, listOrders } = await import("../../../backend/id/src/near/services/orders");
    const { ProviderError } = await import("../../../backend/id/src/near/providers/one-click");
    const { previewLimit } = await import("@/lib/near/domain/limit-preview");
    const b = browser();
    await register(b, authenticator());
    const account = (await b.call("state")).data.account;
    const preview = previewLimit({ side: "buy", quantity: "0.025", price: "4", expiryHours: 24 }, {
      accountId: account.intentsIdentity.accountId, blockHeight: 1, checkedAt: Date.now(),
      assets: ASSETS.map(a => ({ ...a, raw: "0", amount: "0" })),
    });
    // Synthetic provider threshold, not a claim about the live minimum.
    const reason = "Limit order amount must be at least 0.1 USD";
    const provider = { create: vi.fn().mockRejectedValue(new ProviderError(400, "order-rejected", false, undefined, reason)), get: vi.fn(), cancel: vi.fn() };
    const service = new OrderService(store, provider, true);
    for (let i = 0; i < 2; i++) {
      await expect(service.create(b.jar.near_session, "rejected-request", preview)).rejects.toMatchObject({
        code: "LIMIT_ORDER_AMOUNT_TOO_SMALL", minimumUsd: "0.10", message: "Minimum order value is 0.10 USD. Increase the size slightly.",
      });
    }
    expect(provider.create).toHaveBeenCalledOnce();
    expect(provider.get).not.toHaveBeenCalled();
    expect((await listOrders(store, b.jar.near_session))[0]).toMatchObject({
      state: "failed", creationRejection: { status: 400, code: "order-rejected", reason },
    });
  });
  it("persists claims before network calls and prevents duplicates and cross-account access", async () => {
    const { OrderService, listOrders } = await import("../../../backend/id/src/near/services/orders");
    const { previewLimit } = await import("@/lib/near/domain/limit-preview");
    const { ASSETS } = await import("@/lib/near/domain/assets");
    const b = browser();
    await register(b, authenticator());
    const account = (await b.call("state")).data.account;
    const p = previewLimit({ side: "buy", quantity: "1", price: "4", expiryHours: 24 }, {
      accountId: account.intentsIdentity.accountId, blockHeight: 1, checkedAt: Date.now(),
      assets: ASSETS.map(a => ({ ...a, raw: "0", amount: "0" })),
    });
    let calls = 0;
    const provider = {
      create: async () => { calls++; throw new Error("lost response"); },
      get: async () => { throw new Error("must not reach provider"); },
      cancel: async () => { throw new Error("must not reach provider"); },
    };
    const service = new OrderService(store, provider, true);
    const concurrent = await Promise.allSettled([
      service.create(b.jar.near_session, "request-1", p),
      service.create(b.jar.near_session, "request-1", p),
    ]);
    expect(concurrent.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const repeated = await service.create(b.jar.near_session, "request-1", p);
    expect(calls).toBe(1);
    expect(repeated.state).toBe("unknown");
    expect((await b.call("live/orders")).data.orders).toHaveLength(1);
    expect(await listOrders(store, b.jar.near_session)).toHaveLength(1);
    // Simulate termination after the durable claim, before either result handler ran.
    store.transaction(s => { s.liveOrders![repeated.id].state = "creating"; });
    const find = vi.fn().mockRejectedValue(new Error("not yet visible"));
    const recovering = new OrderService(store, { ...provider, find }, true);
    await expect(recovering.sync(b.jar.near_session, repeated.id)).rejects.toThrow("reconciliation");
    expect(find).not.toHaveBeenCalled();
    const duplicate = await recovering.create(b.jar.near_session, "new-browser-request", p);
    expect(duplicate.id).toBe(repeated.id);
    expect(calls).toBe(1);
    store.transaction(s => { s.liveOrders![repeated.id].updatedAt = Date.now() - 61_000; });
    await expect(recovering.sync(b.jar.near_session, repeated.id)).rejects.toThrow("not yet visible");
    expect(find).toHaveBeenCalledOnce();
    expect(calls).toBe(1);

    await expect(service.create(b.jar.near_session, "request-1", { ...p, request: { ...p.request, data: { ...p.request.data, attributes: { ...p.request.data.attributes, price: "5" } } } })).rejects.toThrow("different terms");
    const other = browser();
    await register(other, authenticator());
    expect(await listOrders(store, other.jar.near_session)).toHaveLength(0);
    await expect(service.sync(other.jar.near_session, repeated.id)).rejects.toThrow("not found");
    await expect(new OrderService(store, provider).create(b.jar.near_session, "request-2", p)).rejects.toThrow("disabled");
    expect(calls).toBe(1);
  });
});

describe("backup passkey preparation", () => {
  it("requires primary approval, binds and tests the backup without activating recovery", async () => {
    const b = browser(), primary = authenticator(), backup = authenticator();
    await register(b, primary);
    const before = (await b.call("state")).data.account;
    expect((await b.call("backup/register/options", {})).status).toBe(400);
    const approve = await b.call("backup/authorize/options", {});
    expect((await b.call("backup/authorize/verify", primary.assertion(approve.data.challenge, 1))).status).toBe(200);
    const options = await b.call("backup/register/options", {});
    expect(options.data.excludeCredentials[0].id).toBe(primary.id);
    const created = await b.call("backup/register/verify", backup.registration(options.data.challenge));
    expect(created.status, JSON.stringify(created.data)).toBe(200);
    expect((await b.call("backup/register/verify", backup.registration(options.data.challenge))).status).toBe(400);
    const test = await b.call("backup/test/options", {});
    expect(test.data.allowCredentials[0].id).toBe(backup.id);
    const proof = backup.assertion(test.data.challenge, 1);
    expect((await b.call("backup/test/verify", proof)).status).toBe(200);
    expect((await b.call("backup/test/verify", proof)).status).toBe(400);
    const after = (await b.call("state")).data.account;
    expect(after.intentsIdentity).toEqual(before.intentsIdentity);
    expect(after.id).toBe(before.id);
    expect(after.backup.status).toBe("pending_onchain");
    expect(after.backup.testedAt).toBeGreaterThan(0);
    await b.call("auth/logout", {});
    const login = await b.call("auth/login/options", {});
    expect((await b.call("auth/login/verify", backup.assertion(login.data.challenge, 2))).status).toBe(400);
  });
  it("rejects a different key approving setup and anonymous sessions", async () => {
    const b = browser(), primary = authenticator(), attacker = authenticator();
    await register(b, primary);
    const options = await b.call("backup/authorize/options", {});
    expect((await b.call("backup/authorize/verify", attacker.assertion(options.data.challenge, 1))).status).toBe(400);
    expect((await b.call("backup/register/options", {})).status).toBe(400);
    const anonymous = browser();
    expect((await anonymous.call("backup/authorize/options", {})).status).toBe(400);
  });
});

});

it('publishes reviewed CoinGecko metadata without replacing the raw provider signing identity',async()=>{
 origin='http://localhost:3100';vi.stubEnv('APP_ORIGIN',origin);
 store.transaction(s=>{s.tokens![DEFAULT_PAIR.base.assetId].coingeckoIdOverride='reviewed-coin';});
 const client=browser();
 const catalog=await client.call('catalog');
 expect(catalog.status).toBe(200);
 expect(catalog.data.assets.find((a:{assetId:string})=>a.assetId===DEFAULT_PAIR.base.assetId)).toMatchObject({coingeckoId:'near',coingeckoIdOverride:'reviewed-coin'});
 const metadata=await client.call('metadata-catalog');
 expect(metadata.status).toBe(200);
 expect(metadata.data.assets.find((a:{assetId:string})=>a.assetId===DEFAULT_PAIR.base.assetId)).toMatchObject({coingeckoId:'near',coingeckoIdOverride:'reviewed-coin',trading:true});
 store.transaction(s=>{s.tokens![DEFAULT_PAIR.base.assetId].status='disabled';});
 const disabled=await client.call('metadata-catalog');
 expect(disabled.data.assets.find((a:{assetId:string})=>a.assetId===DEFAULT_PAIR.base.assetId)).toMatchObject({coingeckoId:'near',trading:false});
 expect(disabled.data.assets.find((a:{assetId:string})=>a.assetId===DEFAULT_PAIR.base.assetId).coingeckoIdOverride).toBeUndefined();
});

it("exposes deposit readiness only for a valid chain-bound refund without affecting withdrawals", async () => {
  origin = "http://localhost:3100"; asyncStorage = false; vi.stubEnv("APP_ORIGIN", origin);
  const b = browser();
  const read = async () => (await b.call("catalog")).data.networks.find((n: { id: string }) => n.id === "bsc");
  expect(await read()).toMatchObject({ deposits: false, withdrawals: true });
  store.transaction(s => { s.networks!.bsc = { ...s.networks!.bsc, addressKind: "evm", evmChainId: 56 }; s.accessRecords ??= {}; s.accessRecords["refund:bsc"] = { kind: "refund-setting", id: "refund:bsc", networkId: "bsc", chainId: 56, address: "0x" + "d".repeat(40), revision: 1, updatedAt: 0, updatedBy: "operator" }; });
  expect(await read()).toMatchObject({ deposits: true, withdrawals: true });
  store.transaction(s => { s.networks!.bsc.evmChainId = 999; });
  expect(await read()).toMatchObject({ deposits: false, withdrawals: true });
  store.transaction(s => { s.networks!.bsc.evmChainId = 56; const r = s.accessRecords!["refund:bsc"]; if (r.kind === "refund-setting") r.address = ""; });
  expect(await read()).toMatchObject({ deposits: false, withdrawals: true });
});
