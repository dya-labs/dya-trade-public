import { approvedTestTokens } from "./fixtures/token-policy";
// @vitest-environment node
import { expect, it, vi } from "vitest";
import { runTransfers } from "../../../backend/id/src/near/services/transfers-workflow";
import { emptyState, type StateStore } from "../../../backend/id/src/near/repositories/store";
import { DEFAULT_PAIR } from "../../../packages/wallet-contracts/src/domain/catalog";
import { approvedTestNetworks } from "./fixtures/network-policy";
vi.mock("../../../backend/id/src/near/auth/intents", () => ({ accountIdentity: () => ({ accountId: "0x" + "a".repeat(40) }), encodeAssertion: vi.fn() }));
vi.mock("../../../backend/id/src/near/providers/catalog", () => ({ readCatalog: async () => [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }, ...["eth", "base", "pol"].map(blockchain => ({ ...DEFAULT_PAIR.quote, assetId: `${blockchain}-usdc`, blockchain, coingeckoId: "usd-coin" })), { ...DEFAULT_PAIR.quote, assetId: "new-usdc", blockchain: "unknown", coingeckoId: "usd-coin" }] }));
vi.mock("../../../backend/id/src/near/services/one-click-deposit", () => ({ createDepositQuote: vi.fn(), readDepositStatus: vi.fn() }));
vi.mock("../../../backend/id/src/near/services/one-click-withdraw", () => ({ prepareWithdrawal: vi.fn(), publishWithdrawal: vi.fn(), validateWithdrawal: vi.fn() }));
import { createDepositQuote } from "../../../backend/id/src/near/services/one-click-deposit";
import { prepareWithdrawal } from "../../../backend/id/src/near/services/one-click-withdraw";
function context(body: Record<string, unknown>, route = "transfers/preview") {
  const s = emptyState(); s.networks = Object.fromEntries(approvedTestNetworks.map(n => [n.id, n]));
  s.tokens=Object.fromEntries(approvedTestTokens([{...DEFAULT_PAIR.quote,coingeckoId:"usd-coin"},...["eth", "base", "pol"].map(blockchain => ({ ...DEFAULT_PAIR.quote, assetId: `${blockchain}-usdc`, blockchain, coingeckoId: "usd-coin" })),{...DEFAULT_PAIR.quote,assetId:"new-usdc",blockchain:"unknown",coingeckoId:"usd-coin"}]).map(t=>[t.id,t]));
  const store: StateStore = { read: fn => fn(s), transaction: fn => fn(s) };
  return { route, body, store, deployment: { origin: "https://id.example.test", rpId: "id.example.test", hosted: true, secure: true }, url: new URL("https://id.example.test"), account: { id: "test", kind: "passkey", publicKey: "synthetic", credentialId: "synthetic" }, balanceReader: vi.fn() } as unknown as Parameters<typeof runTransfers>[0];
}
it("rejects a newly discovered deposit chain before requesting a quote and retains the full catalog identity", async () => {
  const c = context({ direction: "deposit", sourceAssetId: "new-usdc", targetAssetId: DEFAULT_PAIR.quote.assetId });
  await expect(runTransfers(c)).rejects.toThrow("Transfers on this network");
  expect(createDepositQuote).not.toHaveBeenCalled();
  expect(await c.store.read(s => s.networks?.unknown.status)).toBe("pending");
});
it("rejects an unknown withdrawal destination before reading balances or preparing a signature", async () => {
  const c = context({ direction: "withdraw", originAssetId: DEFAULT_PAIR.quote.assetId, destinationAssetId: "new-usdc" });
  await expect(runTransfers(c)).rejects.toThrow("Transfers on this network");
  expect(c.balanceReader).not.toHaveBeenCalled(); expect(prepareWithdrawal).not.toHaveBeenCalled();
});
it("enforces deposit approval on direct bridge/address requests", async () => {
  await expect(runTransfers(context({ assetId: "new-usdc" }, "bridge/address"))).rejects.toThrow("Transfers on this network");
});
it("blocks submission when a network was disabled after preview, before verifying or publishing", async () => {
  const c = context({}, "transfers/submit"); c.ceremony = "reviewed";
  const { hash } = await import("../../../backend/id/src/near/repositories/store");
  await c.store.transaction(s => {
    s.networks!.near = { ...s.networks!.near, status: "disabled", withdrawals: false };
    s.challenges[hash("reviewed")] = { value: "synthetic", purpose: "withdraw", accountId: "test", payload: "synthetic", expires: Date.now() + 60000, withdrawal: { originAsset: DEFAULT_PAIR.quote.assetId, destinationAsset: DEFAULT_PAIR.quote.assetId, confidentiality: "advanced", asset: "USDC", route: { origin: { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }, destination: { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" } }, destinationWallet: "0x" + "b".repeat(40) } as never };
  });
  await expect(runTransfers(c)).rejects.toThrow("Transfers on this network");
  const { publishWithdrawal } = await import("../../../backend/id/src/near/services/one-click-withdraw");
  expect(publishWithdrawal).not.toHaveBeenCalled();
});

it.each(["eth", "base", "pol"].flatMap(chain => ["", undefined].map(wallet => ({ chain, wallet }))))("requests a $chain confidential deposit quote without a user refund address ($wallet)", async ({ chain, wallet }) => {
  const c = context({ direction: "deposit", sourceAssetId: `${chain}-usdc`, targetAssetId: `${chain}-usdc`, wallet });
  await c.store.transaction(s => { s.networks![chain] = { ...s.networks!.eth, id: chain, addressKind: "evm", evmChainId: 1 }; s.accessRecords ??= {}; s.accessRecords[`refund:${chain}`] = { kind: "refund-setting", id: `refund:${chain}`, networkId: chain, chainId: 1, address: "0x" + "d".repeat(40), revision: 1, updatedAt: 0, updatedBy: "operator" }; });
  const requested = new Error("quote requested");
  vi.mocked(createDepositQuote).mockRejectedValueOnce(requested);
  await expect(runTransfers(c)).rejects.toBe(requested);
  expect(createDepositQuote).toHaveBeenLastCalledWith(c.body, "0x" + "a".repeat(40), expect.any(String), undefined, undefined, true, expect.any(Array), "0x" + "d".repeat(40));
});

it("rejects deposits on EVM routes without a configured fixed refund", async () => {
  const c = context({ direction: "deposit", sourceAssetId: "new-usdc", targetAssetId: "new-usdc", wallet: "" });
  await c.store.transaction(s => {
    s.networks!.unknown = { ...s.networks!.eth, id: "unknown", addressKind: "evm" };
  });
  const calls = vi.mocked(createDepositQuote).mock.calls.length;
  await expect(runTransfers(c)).rejects.toThrow("Transfers on this network");
  expect(createDepositQuote).toHaveBeenCalledTimes(calls);
});
it.each([undefined, "", "bad-address"])("rejects an approved EVM deposit without a valid configured refund (%s) before requesting a quote", async address => {
  const c = context({ direction: "deposit", sourceAssetId: "eth-usdc", targetAssetId: "eth-usdc", wallet: "0x" + "b".repeat(40) });
  await c.store.transaction(s => {
    s.networks!.eth = { ...s.networks!.eth, addressKind: "evm", evmChainId: 1 };
    if (address !== undefined) { s.accessRecords ??= {}; s.accessRecords["refund:eth"] = { kind: "refund-setting", id: "refund:eth", networkId: "eth", chainId: 1, address, revision: 1, updatedAt: 0, updatedBy: "operator" }; }
  });
  const calls = vi.mocked(createDepositQuote).mock.calls.length;
  await expect(runTransfers(c)).rejects.toThrow("Transfers on this network");
  expect(createDepositQuote).toHaveBeenCalledTimes(calls);
});
