import { afterEach, beforeEach, expect, test } from "vitest";
import { harness, origin, synchronized } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { discoverNetworks, requireNetwork } from "../src/near/services/network-policy";
import { DEFAULT_PAIR } from "../../../packages/wallet-contracts/src/domain/catalog";
let h: Awaited<ReturnType<typeof harness>>;
const now = Date.now();
const store = () => new D1Store(h.db, origin, new StatementBudget("paid"));
beforeEach(async () => { h = await harness(); });
afterEach(async () => { await h?.mf.dispose(); });
test("fixed migration seeds existing networks but unknown discovery stays pending and survives restart of store", async () => {
  expect(await store().read(s => requireNetwork(s, "hood", "deposits").evmChainId)).toBe(4663);
  await discoverNetworks(store(), [{ ...DEFAULT_PAIR.quote, blockchain: "new-chain" }], now);
  expect(await store().read(s => s.networks!["new-chain"])).toMatchObject({ status: "pending", deposits: false, withdrawals: false });
  await expect(store().read(s => requireNetwork(s, "new-chain", "deposits"))).rejects.toThrow();
  await expect(store().read(s => requireNetwork(s, "absent", "withdrawals"))).rejects.toThrow();
});
test("a reviewed network record enables only its approved directions", async () => {
  await discoverNetworks(store(), [{ ...DEFAULT_PAIR.quote, blockchain: "new-chain" }], now);
  await store().transaction(s => { s.networks!["new-chain"] = { ...s.networks!["new-chain"], name: "Reviewed network", iconUrl: "https://example.test/icon.png", explorerUrl: "https://example.test/explorer", addressKind: "evm", evmChainId: 999, status: "approved", deposits: true, withdrawals: false, revision: 1 }; });
  expect(await store().read(s => requireNetwork(s, "new-chain", "deposits").name)).toBe("Reviewed network");
  await expect(store().read(s => requireNetwork(s, "new-chain", "withdrawals"))).rejects.toThrow();
  await discoverNetworks(store(), [{ ...DEFAULT_PAIR.quote, blockchain: "new-chain" }], now);
  expect(await store().read(s => s.networks!["new-chain"].status)).toBe("approved");
});
test("concurrent discovery never overwrites a review and wallet data remains intact when disabled", async () => {
  await store().transaction(s => { s.accounts.keep = { id: "keep", kind: "passkey", counter: 0 }; });
  const db = synchronized(h.db);
  await Promise.all([1,2].map(() => discoverNetworks(new D1Store(db, origin, new StatementBudget("paid")), [{ ...DEFAULT_PAIR.quote, blockchain: "new-chain" }], now)));
  await store().transaction(s => { s.networks!.hood = { ...s.networks!.hood, status: "disabled", deposits: false, withdrawals: false }; });
  await discoverNetworks(store(), [{ ...DEFAULT_PAIR.quote, blockchain: "hood" }], now);
  await expect(store().read(s => requireNetwork(s, "hood", "withdrawals"))).rejects.toThrow();
  expect(await store().read(s => s.accounts.keep.id)).toBe("keep");
});
test("network and token migrations preserve existing wallets", async () => {
  await h.mf.dispose(); h = await harness(true, undefined, true, false);
  await h.raw.prepare("INSERT INTO id_accounts(id,data) VALUES(?,?)").bind("existing", JSON.stringify({ id: "existing", kind: "passkey", publicKey: "synthetic", counter: 7 })).run();
  const { readFile } = await import("node:fs/promises");
  const sql = (await readFile(new URL("../d1-migrations/0004_networks.sql", import.meta.url), "utf8")) + (await readFile(new URL("../d1-migrations/0005_tokens.sql", import.meta.url), "utf8"));
  const statements = sql.match(/CREATE TRIGGER[\s\S]*?\nEND;|CREATE (?:TABLE|INDEX)[^;]+;|(?:ALTER|DROP|INSERT|UPDATE)[^;]+;/g)!;
  await h.raw.batch(statements.map(statement => h.raw.prepare(statement)));
  expect(await store().read(s => s.accounts.existing)).toEqual({ id: "existing", kind: "passkey", publicKey: "synthetic", counter: 7 });
  expect(await store().read(s => Object.keys(s.networks!).length)).toBe(23);
});
