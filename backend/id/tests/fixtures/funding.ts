import { DEFAULT_PAIR, makePair, quantityRaw, type CatalogAsset } from "../../../../packages/wallet-contracts/src/domain/catalog";
import { PRIVATE_VERIFIER, PRIVATE_SALT, privateAssetId } from "../../../../packages/wallet-contracts/src/domain/confidential";
import { payloadChallenge, versionedNonce } from "../../src/near/auth/intents";
import type { ExecutableMarketTrade } from "../../src/near/services/market-execution";
import type { StoredFundingBatch } from "../../src/near/services/funding-conversions";
export const identity = "0x" + "a".repeat(40);
export const source: CatalogAsset = { ...DEFAULT_PAIR.quote, assetId: "base-usdc", blockchain: "base", coingeckoId: "usd-coin", price: 1 };
export const other: CatalogAsset = { ...source, assetId: "eth-dai", blockchain: "eth", symbol: "DAI", coingeckoId: "dai", decimals: 18 };
export const quote = { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" };
export const catalog = [quote, source, other];
export function trade(asset = source, amount = "1"): ExecutableMarketTrade {
  const expiresAt = new Date(Date.now() + 120000).toISOString();
  const inputRaw = quantityRaw(amount, asset.decimals);
  const payload = JSON.stringify({ signer_id: identity, verifying_contract: PRIVATE_VERIFIER, nonce: versionedNonce(PRIVATE_SALT, Date.parse(expiresAt)), deadline: expiresAt, intents: [{ intent: "transfer", receiver_id: "1".repeat(64), tokens: { [privateAssetId(asset.assetId)]: inputRaw } }] });
  return { confidentiality: "advanced", orderType: "market", side: "sell", submissionEnabled: true, quantity: amount, pair: makePair(asset, quote), inputSymbol: asset.symbol, outputSymbol: "USDC", inputRaw, outputRaw: "999000", principal: amount, estimatedOutput: "0.999", minimumOutput: "0.99", available: amount, shortfall: "0", balanceBlock: 0, slippageBps: 100, expiresAt, depositAddress: "1".repeat(64), depositMemo: null, correlationId: "test", payload, challenge: payloadChallenge(payload).toString("base64url") };
}
export function batch(): StoredFundingBatch {
  const review = trade();
  return { id: "batch", createdAt: Date.now(), updatedAt: Date.now(), expiresAt: review.expiresAt, state: "ready", outputAmount: "1.998", minimumOutput: "1.98", inputUsd: "2", costUsd: "0.002", excluded: [], legs: [source, other].map((asset, i) => ({ id: String(i), asset, amount: "1", state: "ready", review: trade(asset) })) };
}
export const balances = { accountId: identity, blockHeight: 0, checkedAt: 0, assets: [source, other].map(a => ({ ...a, amount: "1", raw: quantityRaw("1", a.decimals) })) };
