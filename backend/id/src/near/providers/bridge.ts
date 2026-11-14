import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import type { Network } from "../../../../../packages/wallet-contracts/src/domain/networks";
import { networkFor } from "../../../../../packages/wallet-contracts/src/domain/bridge-networks";
import { parse } from "lossless-json";
import { z } from "zod";
import { providerFetch } from "./http";
import { readCatalog } from "./catalog";
import { rawAmount, text } from "../../../../../packages/wallet-contracts/src/http/schemas/common";
import { bridgeAddress, bridgeDeposit, bridgeRoute } from "../../../../../packages/wallet-contracts/src/http/schemas/bridge";

const BASE = "https://bridge.chaindefuser.com/rpc";
const tokenSchema = z.object({
  defuse_asset_identifier: text, intents_token_id: text.optional(), near_token_id: text,
  decimals: z.number().int().min(0).max(38), min_deposit_amount: rawAmount,
  standard: z.string().optional(),
});
export async function bridgeRpc(method: string, params: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<unknown> {
  const response = await providerFetch(fetcher, BASE, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "terminal-bridge", method, params: [params] }) });
  const payload = z.object({ result: z.unknown().optional(), error: z.unknown().optional() }).parse(parse(await response.text(), undefined, { parseNumber: value => Number.isSafeInteger(Number(value)) ? Number(value) : value }));
  if (!response.ok || payload.error || !payload.result) throw new AppError(ErrorCode.DepositBridgeUnavailable);
  return payload.result;
}
export async function readBridgeRoutes(fetcher: typeof fetch = fetch, catalogReader = readCatalog, networks?: Network[]) {
  const [data, catalog] = await Promise.all([bridgeRpc("supported_tokens", {}, fetcher), catalogReader()]);
  const tokens = z.object({ tokens: z.array(tokenSchema) }).parse(data).tokens;
  const routes: z.infer<typeof bridgeRoute>[] = [];
  for (const token of tokens) {
    const id = token.intents_token_id ?? (token.standard === undefined || token.standard === "nep141" ? `nep141:${token.near_token_id}` : "");
    const asset = catalog.find(a => a.assetId === id && a.decimals === token.decimals);
    const chain = token.defuse_asset_identifier.split(":").slice(0, 2).join(":");
    const mapped = asset && networks?.find(n => n.id === asset.blockchain);
    const matches = networks ? !!mapped && (chain.startsWith("eth:") ? mapped.addressKind === "evm" && String(mapped.evmChainId) === chain.slice(4) : chain === `${mapped.id}:mainnet`) : networkFor(chain) === asset?.blockchain;
    if (asset && matches && !routes.some(r => r.asset.assetId === id && r.chain === chain)) routes.push({ asset, chain, minimum: token.min_deposit_amount });
  }
  return routes;
}
export async function createBridgeAddress(accountId: string, assetId: unknown, fetcher: typeof fetch = fetch, routesReader = readBridgeRoutes) {
  if (!/^0x[0-9a-f]{40}$/.test(accountId)) throw new AppError(ErrorCode.InvalidIntentsAccount);
  const matches = (await routesReader()).filter(r => r.asset.assetId === assetId);
  if (matches.length !== 1) throw new AppError(ErrorCode.ChooseASupportedDepositTokenAndNetwork);
  const route = matches[0];
  const result = z.object({ address: text, chain: text, memo: z.string().nullable().optional() }).parse(await bridgeRpc("deposit_address", {
    account_id: accountId, chain: route.chain, deposit_mode: route.chain === "stellar:mainnet" ? "MEMO" : "SIMPLE",
  }, fetcher));
  if (result.chain !== route.chain || /\s/.test(result.address) || (route.chain === "stellar:mainnet" && !result.memo)) throw new Error("Invalid deposit address response");
  return bridgeAddress.parse({ ...route, address: result.address, memo: result.memo ?? null });
}
const bridgeRaw = z.union([rawAmount, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String)]);
export async function readBridgeDeposits(accountId: string, fetcher: typeof fetch = fetch, catalogReader = readCatalog) {
  const result = z.object({ deposits: z.array(z.object({
    account_id: text, chain: text, near_token_id: text, intents_token_id: text.optional(), amount: bridgeRaw,
    decimals: z.number().int().min(0).max(38), status: z.enum(["PENDING", "COMPLETED", "FAILED"]), tx_hash: z.string(), address: text,
  })) }).parse(await bridgeRpc("recent_deposits", { account_id: accountId }, fetcher));
  if (result.deposits.some(d => d.account_id !== accountId)) throw new Error("Deposit account mismatch");
  if (!result.deposits.length) return [];
  const [metadata, catalog] = await Promise.all([bridgeRpc("supported_tokens", {}, fetcher), catalogReader()]);
  const tokens = z.object({ tokens: z.array(tokenSchema) }).parse(metadata).tokens;
  return result.deposits.map(d => {
    const matches = tokens.filter(t =>
      t.near_token_id === d.near_token_id && t.decimals === d.decimals &&
      t.defuse_asset_identifier.split(":").slice(0, 2).join(":") === d.chain
    ).flatMap(t => {
      const id = t.intents_token_id ?? (t.standard === undefined || t.standard === "nep141" ? `nep141:${t.near_token_id}` : "");
      return catalog.filter(a => a.assetId === id && a.decimals === d.decimals && a.blockchain === networkFor(d.chain));
    });
    const historicalMatches = catalog.filter(a =>
      ["nep141", "nep245"].some(standard => a.assetId === `${standard}:${d.near_token_id}`) &&
      a.decimals === d.decimals && a.blockchain === networkFor(d.chain));
    const ids = [...new Set([...matches, ...historicalMatches].map(a => a.assetId))];
    // Explicit history IDs remain authoritative. Legacy history omits the
    // standard, so require an unambiguous exact identity, network and decimals match.
    const assetId = d.intents_token_id ?? (ids.length === 1 ? ids[0] : `nep141:${d.near_token_id}`);
    return bridgeDeposit.parse({ assetId, chain: d.chain,
    amount: d.amount, decimals: d.decimals, status: d.status, txHash: d.tx_hash, address: d.address });
  });
}
