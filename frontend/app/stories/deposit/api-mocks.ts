import { tokenIdentity } from "../../../../packages/wallet-contracts/src/domain/token-registry";
import { readNetworkIcons } from "../../../../backend/id/src/near/providers/network-icons";
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { fundedNetworkFixture, fundedNetworkCatalog } from '../trade-entry/funded-network-fixture';
import type { TrackedDepositQuote } from '@/lib/near/http/schemas/transfers';
export const assets = [
  { ...DEFAULT_PAIR.quote, coingeckoId: 'usd-coin', price: 1 },
  { ...DEFAULT_PAIR.quote, assetId: 'storybook:base-usdc', blockchain: 'base', coingeckoId: 'usd-coin', price: 1 },
];
export const quote = {
  id: 'storybook-deposit', asset: 'USDC', sourceChain: 'Base', sourceNetwork: 'base',
  depositAddress: '0x1234567890abcdef1234567890abcdef12345678', amountInFormatted: '1',
  minAmountInFormatted: '1', showDollarBuffer: true, deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
} as TrackedDepositQuote;
export let scenario = 'PENDING_DEPOSIT';
let statusReads = 0;
let prepareRequests = 0;
let rejectPendingPrepare: ((error: Error) => void) | null = null;
export function failPendingPrepare() { scenario = "REFUND_RECOVERY";rejectPendingPrepare?.(new Error("Deposit service temporarily unavailable. Please try again."));rejectPendingPrepare = null; }
export function setScenario(value: string) { scenario = value; statusReads = 0; prepareRequests = 0;rejectPendingPrepare = null; }
export async function getCatalog() { const catalogAssets = fundedNetworkFixture ? fundedNetworkCatalog : assets;
  return { assets: catalogAssets, tokens: catalogAssets.map(asset => ({ id: asset.assetId, identity: tokenIdentity(asset), observed: tokenIdentity(asset), status: "approved" as const, trading: true, deposits: true, withdrawals: true, name: asset.symbol, iconUrl: "", discoveredAt: 0, updatedAt: 0, revision: 1 })), networks: [...new Set(catalogAssets.map(asset => asset.blockchain))].map(id => ({ id, status: "approved" as const, deposits: true, withdrawals: true, name: id === "base" ? "Base" : id === "near" ? "NEAR" : id })) }; }
export async function getTokenIcons() { return { icons: {} }; }
export async function getNetworkIcons() { return { icons: await readNetworkIcons() }; }
export async function prepareDeposit() {
  if (scenario === "PREPARE_LOADING") { await new Promise(resolve => setTimeout(resolve, 2000)); return { ...quote, deadline: new Date(Date.now() + 15 * 60_000).toISOString() }; }
  if (scenario === "PREPARE_REFUND_PENDING") return await new Promise<typeof quote>((_resolve, reject) => { rejectPendingPrepare = reject; });
  if (scenario === "REFUND_RECOVERY") return { ...quote, deadline: new Date(Date.now() + 15 * 60_000).toISOString(), sourceChain: "NEAR", sourceNetwork: "near" };
  if (scenario === 'PREPARE_ERROR' || (scenario === 'PREPARE_RECOVERY' && ++prepareRequests === 1)) throw new Error('Deposit service temporarily unavailable. Please try again.');
  return { ...quote, deadline: new Date(Date.now() + 15 * 60_000).toISOString() };
}
export async function getDepositStatus() {
  if (scenario === "PROCESSING_TO_COMPLETE") return { providerStatus: ++statusReads === 1 ? "PROCESSING" : "SUCCESS", deposit: {} };
  if (scenario === 'CHECKING') return new Promise<never>(() => {});
  if (scenario === 'STATUS_ERROR') throw new Error('Demo status unavailable');
  if (scenario === 'CACHED_STATUS_ERROR' && ++statusReads > 1) throw new Error('Demo cached status unavailable');
  return { providerStatus: ['CACHED_STATUS_ERROR', 'PREPARE_RECOVERY', 'REFUND_RECOVERY', 'PREPARE_LOADING'].includes(scenario) ? 'PENDING_DEPOSIT' : scenario, deposit: {} };
}
export { prepareWithdrawal, submitWithdrawal, getWithdrawalStatus } from '../withdrawal/api-mocks';
export { getTokenMarkets, getWithdrawals, getDeposits, getBridgeDeposits } from '../wallet/api-mocks';

export async function getTokenLinks() { return { assets: {} }; }
