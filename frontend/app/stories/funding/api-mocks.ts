import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import type { FundingBatch } from '@/lib/near/http/schemas/funding-conversions';
let scenario = '';
let operation: FundingBatch | null = null;
let historyFailures = 0;
export function failNextFundingHistory() { historyFailures = 1; }
export function resetFunding() { scenario = ''; operation = null;historyFailures = 0; }
export function setFundingScenario(value: string) { scenario = value; operation = null;historyFailures = 0; }
export function seedFundingScenario(value: string) { scenario = value;operation = batch(); }
export function fundingOperations() { if (historyFailures > 0) { historyFailures--;throw new Error("Demo funding history unavailable"); } return operation ? [operation] : []; }
function batch(): FundingBatch {
  const state = ({ Processing: 'processing', Completed: 'settled', Partial: 'partial', Failed: 'failed', Unknown: 'unknown', StatusUnavailable: 'processing', Cancelled: 'cancelled' } as Record<string, FundingBatch['state']>)[scenario] ?? 'ready';
  const legState = ({ processing: 'submitted', settled: 'settled', partial: 'settled', failed: 'failed', unknown: 'unknown', cancelled: 'cancelled', ready: 'ready' } as const)[state];
  return {
    id: 'storybook-funding', createdAt: Date.now(), updatedAt: Date.now(), state,
    expiresAt: new Date(Date.now() + (scenario === 'Expired' ? -1000 : 120000)).toISOString(),
    outputAmount: state === 'partial' ? '349.00' : '249.50', minimumOutput: state === 'partial' ? '345.00' : '247.00', inputUsd: state === 'partial' ? '350' : '250', costUsd: state === 'partial' ? '1.00' : '0.50', excluded: [],
    legs: [{ id: 'base-leg', asset: { ...DEFAULT_PAIR.quote, assetId: 'storybook:base-usdc', blockchain: 'base', coingeckoId: 'usd-coin' }, amount: '250', state: legState,
      review: { estimatedOutput: '249.50', minimumOutput: '247.00' } as FundingBatch['legs'][number]['review'] },
      ...(state === 'partial' ? [{ id: 'failed-leg', asset: { ...DEFAULT_PAIR.quote, assetId: 'storybook:usdt', symbol: 'USDT', blockchain: 'bsc', coingeckoId: 'tether' }, amount: '100', state: 'failed' as const, review: { estimatedOutput: '99.50', minimumOutput: '98.00' } as FundingBatch['legs'][number]['review'] }] : [])],
  };
}
export async function prepareFunding() {
  if (scenario === 'QuoteUnavailable') throw new Error('Couldn’t get conversion quotes. Try again.');
  operation = batch(); return { operation };
}
export async function authorizeFunding() {
  if (['Confirmation', 'Review'].includes(scenario)) return new Promise<never>(() => {});
  return { options: {} };
}
export async function submitFunding() { scenario = 'Processing'; operation = batch(); return { operation }; }
export async function cancelFunding() { scenario = 'Cancelled'; operation = batch(); return { operation }; }
export async function fundingStatus() {
  if (scenario === 'StatusUnavailable') throw new Error('Demo status unavailable');
  return { operation: operation ?? batch() };
}
