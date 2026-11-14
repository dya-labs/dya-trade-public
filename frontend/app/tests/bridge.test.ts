// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createBridgeAddress, readBridgeDeposits, readBridgeRoutes } from "../../../backend/id/src/near/providers/bridge";
const asset = { assetId: "nep141:base-usdc.omft.near", blockchain: "base", decimals: 6, symbol: "USDC" };
const route = { asset, chain: "eth:8453", minimum: "150000" };
const account = "0x" + "a".repeat(40);

it("matches exact bridge identities and decimals rather than token symbols", async () => {
  const fetcher = vi.fn(async () => Response.json({ result: { tokens: [
    { near_token_id: "base-usdc.omft.near", intents_token_id: asset.assetId, defuse_asset_identifier: "eth:8453:usdc", decimals: 6, min_deposit_amount: "150000" },
    { near_token_id: "fake.omft.near", defuse_asset_identifier: "eth:8453:fake", decimals: 6, min_deposit_amount: "1" },
  ] } }));
  expect(await readBridgeRoutes(fetcher, async () => [asset])).toEqual([route]);
});
it("requests an account-bound address without amount, refund address or swap", async () => {
  const fetcher = vi.fn(async (_url, init) => {
    expect(JSON.parse(init!.body as string)).toMatchObject({ method: "deposit_address", params: [{ account_id: account, chain: "eth:8453", deposit_mode: "SIMPLE" }] });
    expect(init!.body).not.toContain('"amount"');
    return Response.json({ result: { address: "0x" + "b".repeat(40), chain: "eth:8453" } });
  });
  expect(await createBridgeAddress(account, asset.assetId, fetcher, async () => [route])).toMatchObject({ ...route, memo: null });
  await expect(createBridgeAddress(account, "fake", fetcher, async () => [route])).rejects.toThrow("supported");
});
it("rejects mismatched networks and missing required memos", async () => {
  await expect(createBridgeAddress(account, asset.assetId, async () => Response.json({ result: { address: "abc", chain: "eth:1" } }), async () => [route])).rejects.toThrow("Invalid deposit");
  await expect(createBridgeAddress(account, asset.assetId, async () => Response.json({ result: { address: "abc", chain: "stellar:mainnet" } }), async () => [{ ...route, chain: "stellar:mainnet" }])).rejects.toThrow("Invalid deposit");
});
const historyFetcher = (deposit: unknown, numeric = false) => vi.fn(async (_url: unknown, init?: RequestInit) => {
  if (JSON.parse(init!.body as string).method === "supported_tokens") return Response.json({ result: { tokens: [] } });
  const body = JSON.stringify({ result: { deposits: [deposit] } });
  return new Response(numeric ? body.replace('"RAW"', "1000000000000000001") : body);
});
it("keeps deposit amounts exact and refuses other account records", async () => {
  const deposit = { account_id: account, chain: "eth:8453", near_token_id: "base-usdc.omft.near", amount: "1000000000000000001", decimals: 18, status: "COMPLETED", tx_hash: "tx", address: "address" };
  expect((await readBridgeDeposits(account, historyFetcher(deposit), async () => []))[0].amount).toBe(deposit.amount);
  expect((await readBridgeDeposits(account, historyFetcher({ ...deposit, amount: "RAW" }, true), async () => []))[0].amount).toBe("1000000000000000001");
  await expect(readBridgeDeposits(account, async () => Response.json({ result: { deposits: [{ ...deposit, account_id: "other" }] } }))).rejects.toThrow("account mismatch");
});


it("resolves legacy BNB history through verified NEP-245 bridge metadata", async () => {
  const nearId = "v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r";
  const bnb = { assetId: `nep245:${nearId}`, blockchain: "bsc", decimals: 18, symbol: "USDC" };
  const token = { near_token_id: nearId, intents_token_id: bnb.assetId, defuse_asset_identifier: "eth:56:usdc", decimals: 18, min_deposit_amount: "1", standard: "nep245" };
  const deposit = { account_id: account, chain: "eth:56", near_token_id: nearId, amount: "999759773090219100", decimals: 18, status: "COMPLETED", tx_hash: "bnb-tx", address: "address" };
  const fetcher = vi.fn(async (_url, init) => Response.json({ result: JSON.parse(init!.body as string).method === "supported_tokens" ? { tokens: [token] } : { deposits: [deposit] } }));
  expect((await readBridgeDeposits(account, fetcher, async () => [bnb]))[0]).toMatchObject({ assetId: bnb.assetId, amount: deposit.amount });
  for (const wrong of [{ ...bnb, decimals: 6 }, { ...bnb, blockchain: "base" }]) {
    expect((await readBridgeDeposits(account, fetcher, async () => [wrong]))[0].assetId).toBe(`nep141:${nearId}`);
  }
});

it("resolves historical tokens absent from current bridge routes without guessing", async () => {
  const nearId = "v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r";
  const bnb = { assetId: `nep245:${nearId}`, blockchain: "bsc", decimals: 18, symbol: "USDC" };
  const deposit = { account_id: account, chain: "eth:56", near_token_id: nearId, amount: "100", decimals: 18, status: "COMPLETED", tx_hash: "tx", address: "address" };
  expect((await readBridgeDeposits(account, historyFetcher(deposit), async () => [bnb]))[0].assetId).toBe(bnb.assetId);
  for (const wrong of [{ ...bnb, decimals: 6 }, { ...bnb, blockchain: "base" }, { ...bnb, assetId: "nep245:other" }]) {
    expect((await readBridgeDeposits(account, historyFetcher(deposit), async () => [wrong]))[0].assetId).toBe(`nep141:${nearId}`);
  }
});
