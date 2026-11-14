import * as existing from '../deposit/api-mocks';
import { quote } from '../deposit/api-mocks';
import type { DepositItem, WithdrawalItem } from '@/lib/near/http/schemas/transfers';
export * from '../deposit/api-mocks';
export const states = ['Mixed', 'SignedOut', 'Loading', 'Empty', 'Unavailable', 'Processing', 'Completed', 'Failed', 'Refunded', 'Incomplete', 'Unconfirmed', 'StatusUnavailable', 'Instructions', 'ExpiredInstructions', 'DirectDeposits', 'DirectUnavailable', 'InvalidTime'] as const;
export type State = typeof states[number];
let state: State | null = null;
export function setTransferState(next: State | null) { state = next; }
const createdAt = Date.parse('2026-10-03T08:00:00Z');
export function fixtures() {
  const deposit: DepositItem = { id: 'demo-deposit', createdAt, quote, status: state === 'Completed' ? 'SUCCESS' : state === 'Failed' ? 'FAILED' : state === 'Refunded' ? 'REFUNDED' : state === 'Incomplete' ? 'INCOMPLETE_DEPOSIT' : state === 'Instructions' || state === 'ExpiredInstructions' ? 'PENDING_DEPOSIT' : 'PROCESSING', originChainTxHashes: [], destinationChainTxHashes: [] };
  if (state === 'ExpiredInstructions') deposit.quote = { ...quote, deadline: '2020-01-01T00:00:00Z' };
  const withdrawal: WithdrawalItem = { id: 'demo-withdrawal', createdAt: createdAt - 3600000, state: state === 'Completed' ? 'settled' : state === 'Failed' ? 'failed' : state === 'Unconfirmed' ? 'unknown' : 'submitted', destinationChainTxHashes: [], review: { direction: 'withdraw', sourceChain: 'NEAR Intents', destinationChain: 'Base', amount: '100', asset: 'USDC', amountRaw: '100000000', destinationWallet: '0x1111111111111111111111111111111111111111', destinationAsset: 'demo', expectedReceive: '99.8', minimumReceive: '98.8', available: '1250', balanceBlock: createdAt, deadline: '2099-01-01T00:00:00Z', depositAddress: 'demo', depositMemo: null, correlationId: 'demo' } };
  if (state === 'InvalidTime') { deposit.createdAt = 9e15; withdrawal.createdAt = 9e15; }
  const empty = ['Empty', 'Loading', 'Unavailable', 'DirectDeposits', 'DirectUnavailable'].includes(state ?? '');
  return { deposits: empty || state === 'Unconfirmed' ? [] : [deposit], withdrawals: empty || ['Instructions', 'ExpiredInstructions', 'Refunded', 'Incomplete'].includes(state ?? '') ? [] : [withdrawal] };
}
async function wait() {
  if (state === 'Loading') await new Promise(() => {});
  if (state === 'Unavailable') throw new Error('Demo transfers unavailable');
}
export async function getDeposits() { if (!state) return existing.getDeposits(); await wait(); return { deposits: fixtures().deposits }; }
export async function getWithdrawals() { if (!state) return existing.getWithdrawals(); await wait(); return { withdrawals: fixtures().withdrawals }; }
export async function getDepositStatus() { if (!state) return existing.getDepositStatus(); if (state === 'StatusUnavailable') throw new Error('Demo stale'); return { deposit: fixtures().deposits[0], providerStatus: fixtures().deposits[0]?.status }; }
export async function getWithdrawalStatus() { if (!state) return existing.getWithdrawalStatus(); if (state === 'StatusUnavailable') throw new Error('Demo stale'); return { withdrawal: fixtures().withdrawals[0] }; }
export async function getBridgeDeposits() {
  if (!state) return existing.getBridgeDeposits();
  if (state === 'DirectUnavailable') throw new Error('Demo bridge unavailable');
  return { deposits: state === 'DirectDeposits' ? [{ assetId: 'storybook:base-usdc', chain: 'eth:8453', amount: '250000000', decimals: 6, status: 'COMPLETED' as const, txHash: '0x' + 'a'.repeat(64), address: 'demo' }] : [] };
}
