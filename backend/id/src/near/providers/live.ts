import { RateLimitError, retryAtFromHeader } from "../../../../../packages/wallet-contracts/src/domain/rate-limit";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { publicRpc, VERIFIER } from "../auth/intents";

import { ASSETS, type LiveBalances } from "../../../../../packages/wallet-contracts/src/domain/assets";
// In-flight sharing only: completed reads are never reused for transaction validation.
const states = new WeakMap<typeof fetch, { retryAt: number; failures: number; pending: Map<string, Promise<LiveBalances>> }>();
export async function readBalances(accountId: string, fetcher: typeof fetch = fetch, assets: readonly { assetId: string; symbol: string; decimals: number }[] = ASSETS): Promise<LiveBalances> {
  let state = states.get(fetcher);
  if (!state) { state = { retryAt: 0, failures: 0, pending: new Map() }; states.set(fetcher, state); }
  if (Date.now() < state.retryAt) throw new RateLimitError(state.retryAt);
  const key = JSON.stringify([accountId, assets]);
  const existing = state.pending.get(key);
  if (existing) return existing;
  const pending = fetchBalances(accountId, fetcher, assets).then(result => {
    if (state.retryAt <= Date.now()) { state.failures = 0; state.retryAt = 0; }
    return result;
  }).catch(error => {
    if (error instanceof RateLimitError) {
      state.failures += 1;
      state.retryAt = Math.max(error.retryAt, Date.now() + Math.min(300000, 30000 * 2 ** (state.failures - 1)));
      throw new RateLimitError(state.retryAt);
    }
    throw error;
  }).finally(() => state.pending.delete(key));
  state.pending.set(key, pending);
  return pending;
}
async function fetchBalances(accountId: string, fetcher: typeof fetch = fetch, assets: readonly { assetId: string; symbol: string; decimals: number }[] = ASSETS): Promise<LiveBalances> {
  if (!/^0x[0-9a-f]{40}$/.test(accountId)) throw new AppError(ErrorCode.InvalidIntentsAccount);
  const res = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "terminal-balances", method: "query", params: {
    request_type: "call_function", finality: "final", account_id: VERIFIER,
    method_name: "mt_batch_balance_of",
    args_base64: Buffer.from(JSON.stringify({ account_id: accountId, token_ids: assets.map(a => a.assetId) })).toString("base64"),
  } }), fetcher);
  if (res.status === 429) throw new RateLimitError(retryAtFromHeader(res.headers.get("Retry-After")));
  if (!res.ok) throw new AppError(ErrorCode.NEARBalanceServiceUnavailableRetryShortly);
  const rpc = await res.json();
  if (rpc.error || rpc.result?.error || !Number.isSafeInteger(rpc.result?.block_height) || !Array.isArray(rpc.result?.result) || !rpc.result.result.every((b: unknown) => typeof b === "number" && Number.isInteger(b) && b >= 0 && b <= 255)) throw new AppError(ErrorCode.InvalidBalanceResponseFromNEAR);
  const amounts: unknown = JSON.parse(Buffer.from(rpc.result.result).toString("utf8"));
  if (!Array.isArray(amounts) || amounts.length !== assets.length || !amounts.every(a => typeof a === "string" && /^(0|[1-9][0-9]{0,38})$/.test(a) && BigInt(a) <= (BigInt(1) << BigInt(128)) - BigInt(1))) throw new AppError(ErrorCode.InvalidTokenBalancesFromNEAR);
  return { accountId, blockHeight: rpc.result.block_height, checkedAt: Date.now(), assets: assets.map((a, i) => ({ ...a, raw: amounts[i], amount: new D(amounts[i]).div(new D(10).pow(a.decimals)).toFixed() })) };
}
// Confidential balances require authenticated account access. Never query public
// RPC or substitute zeros when that integration is unavailable.
export async function readConfidentialBalances(accountId: string): Promise<LiveBalances> {
  if (!/^0x[0-9a-f]{40}$/.test(accountId)) throw new AppError(ErrorCode.InvalidIntentsAccount);
  throw new AppError(ErrorCode.ConfidentialBalanceUnavailablePrivateAccountAuthenticationIsNotConfigured);
}
