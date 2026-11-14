import type { Trade } from '@/lib/near/http/schemas/trading';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
export type State = 'Mixed' | 'SignedOut' | 'Loading' | 'Empty' | 'Unavailable' | 'Processing' | 'Completed' | 'Failed' | 'Unconfirmed' | 'StatusUnavailable';
let state: State = 'Empty';
export function setTradesState(value: State) { state = value; }
function trade(id: string, value: Trade['state'], side: 'buy' | 'sell' = 'buy'): Trade {
  return { id, state: value, createdAt: 1791014400000, updatedAt: 1791014400000, nearTxHashes: value === 'settled' ? ['7'.repeat(44)] : undefined, review: {
    pair: DEFAULT_PAIR, orderType: 'market', side, quantity: '25', inputSymbol: side === 'buy' ? 'USDC' : 'NEAR', outputSymbol: side === 'buy' ? 'NEAR' : 'USDC', principal: side === 'buy' ? '100' : '25', estimatedOutput: side === 'buy' ? '25' : '100', minimumOutput: side === 'buy' ? '24.75' : '99', available: '1250', shortfall: '0', balanceBlock: 1, slippageBps: 100, expiresAt: '2099-01-01T00:00:00Z', submissionEnabled: true, depositAddress: 'demo', depositMemo: null, correlationId: 'demo',
  } };
}
export function fixtures() {
  if (['Empty', 'SignedOut', 'Loading', 'Unavailable'].includes(state)) return [];
  if (state === 'Mixed') return [trade('completed', 'settled'), trade('processing', 'submitted', 'sell'), trade('failed', 'failed')];
  return [trade('demo', state === 'Completed' ? 'settled' : state === 'Failed' ? 'failed' : state === 'Unconfirmed' ? 'unknown' : 'submitted')];
}
export async function getMarketTrades() {
  if (state === 'Loading') return new Promise<never>(() => {});
  if (state === 'Unavailable') throw new Error('Demo unavailable');
  return { trades: fixtures() };
}
export async function getMarketTradeStatus(id: string) {
  if (state === 'StatusUnavailable') throw new Error('Demo status unavailable');
  return { trade: fixtures().find(item => item.id === id)! };
}
