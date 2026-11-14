import { afterEach, expect, test, vi } from "vitest";
import { encodeFinancialRecord as encode, decodeFinancialRecord as decode } from "../src/near/repositories/financial-history";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { harness, origin } from "./d1-harness";
const record = { id: "t", ownerId: "a", createdAt: 1, updatedAt: 2, state: "unknown" as const, review: { amount: "123.456", asset: "secret-token", recipient: "private-address" }, fees: { amount: "0.12" } };
afterEach(() => vi.unstubAllEnvs());
test("randomized authenticated ciphertext covers all non-routing fields", () => {
  vi.stubEnv("FINANCIAL_HISTORY_ALLOW_PLAINTEXT_MIGRATION", "0");
  for (const field of ["liveOrders", "liveTrades", "deposits", "withdrawals", "challenges"]) {
    const value = encode(field, "t", record, origin);
    expect(JSON.stringify(value)).not.toContain("123.456");
    expect(JSON.stringify(value)).not.toContain("private-address");
    expect(decode(field, "t", value, origin)).toEqual(record);
    expect(encode(field, "t", record, origin)).not.toEqual(value);
  }
  const account = { id: "a", credentialId: "credential", publicKey: "public", fundingBatches: { x: record }, consolidations: { y: record } };
  const encrypted = encode("accounts", "a", account, origin);
  expect(encrypted).toMatchObject({ credentialId: "credential", publicKey: "public" });
  expect(JSON.stringify(encrypted)).not.toContain("private-address");
  expect(decode("accounts", "a", encrypted, origin)).toEqual(account);
});
test("fails closed for missing keys, plaintext, changed routing, record, deployment or ciphertext", () => {
  vi.stubEnv("FINANCIAL_HISTORY_ALLOW_PLAINTEXT_MIGRATION", "0");
  const value = encode("liveTrades", "t", record, origin) as Record<string, any>;
  for (const altered of [{ ...value, ownerId: "b" }, { ...value, updatedAt: 3 }, { ...value, review: {} }, { ...value, __financial: { ...value.__financial, v: 2 } }, { ...value, __financial: { ...value.__financial, tag: "AA" } }]) expect(() => decode("liveTrades", "t", altered, origin)).toThrow();
  expect(() => decode("liveTrades", "different", value, origin)).toThrow();
  expect(() => decode("withdrawals", "t", value, origin)).toThrow();
  expect(() => decode("liveTrades", "t", value, "https://other.example")).toThrow();
  expect(() => decode("liveTrades", "t", record, origin)).toThrow();
  vi.stubEnv("FINANCIAL_HISTORY_KEYS", "");
  expect(() => decode("liveTrades", "t", value, origin)).toThrow();
  expect(() => encode("liveTrades", "t", record, origin)).toThrow();
});
test("rotation reads old key and writes active key, independent of JSON property order", () => {
  const old = encode("liveTrades", "t", record, origin) as Record<string, any>;
  vi.stubEnv("FINANCIAL_HISTORY_KEYS", JSON.stringify({ test: "ab".repeat(32), next: "cd".repeat(32) }));
  vi.stubEnv("FINANCIAL_HISTORY_ACTIVE_KEY_ID", "next");
  expect(decode("liveTrades", "t", Object.fromEntries(Object.entries(old).reverse()), origin)).toEqual(record);
  const next = encode("liveTrades", "t", decode("liveTrades", "t", old, origin), origin) as Record<string, any>;
  expect(next.__financial.kid).toBe("next");
  vi.stubEnv("FINANCIAL_HISTORY_KEYS", JSON.stringify({ next: "cd".repeat(32) }));
  expect(decode("liveTrades", "t", next, origin)).toEqual(record);
  expect(() => decode("liveTrades", "t", old, origin)).toThrow();
});
test("D1 stores financial records encrypted and reads them back strictly", async () => {
  const h = await harness();
  try {
    vi.stubEnv("FINANCIAL_HISTORY_ALLOW_PLAINTEXT_MIGRATION", "0");
    const store = () => new D1Store(h.db, origin, new StatementBudget("paid"));
    await store().transaction(s => { s.liveTrades = { t: structuredClone(record) } as unknown as typeof s.liveTrades; });
    const raw = await h.raw.prepare("SELECT data FROM id_trades WHERE id='t'").first<{data:string}>();
    expect(raw?.data).not.toContain("private-address");
    expect(raw?.data).toContain('"__financial"');
    expect(await store().read(s => s.liveTrades?.t)).toEqual(record);
    await store().transaction(s => { s.liveTrades!.t.updatedAt = 4; });
    expect(await store().read(s => s.liveTrades?.t.updatedAt)).toBe(4);
  } finally { await h.mf.dispose(); }
});
