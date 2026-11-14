import { dashboardMode, dashboardBalances } from "./dashboard-api-mocks";
export { getSession, logout } from "./dashboard-api-mocks";
import { resetFunding, fundingOperations } from '../funding/api-mocks';
export { prepareFunding, authorizeFunding, submitFunding, cancelFunding, fundingStatus } from '../funding/api-mocks';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { ConfidentialAccessRequired } from '@/lib/near/domain/confidential-access-error';
import { fundedNetworkFixture, fundedNetworkBalances } from '../trade-entry/funded-network-fixture';

export let walletState = 'Empty';
let balanceReads = 0;
export function setWalletState(state: string) { walletState = state; balanceReads = 0; resetFunding(); }
const pending = () => new Promise<never>(() => {});
export async function getAllBalances() {
  if (fundedNetworkFixture) return { assets: fundedNetworkBalances };
  if (dashboardMode !== null) return dashboardBalances();
  if (walletState === 'Loading') return pending();
  if (walletState === 'LoadingBalanceReveal') await new Promise(resolve => setTimeout(resolve, 2000));
  if (walletState === 'ConfirmAccess') throw new ConfidentialAccessRequired();
  if (walletState === 'BalancesUnavailable') throw new Error('Demo balances unavailable');
  if (walletState === 'BalancesRecoverable' && balanceReads++ === 0) throw new Error('Demo balance refresh failed');
  return { assets: walletState === 'Empty' ? [] : [
    { assetId: DEFAULT_PAIR.quote.assetId, symbol: "USDC", decimals: 6, raw: ['DefaultSourceDrained', 'FundingOnly'].includes(walletState) ? '0' : walletState === 'TicketBalanceChanged' ? '10000000' : '1250500000', amount: ['DefaultSourceDrained', 'FundingOnly'].includes(walletState) ? '0' : walletState === 'TicketBalanceChanged' ? '10' : '1250.50' },
    ...(['TicketBalance', 'TicketBalanceChanged', 'LoadingBalanceReveal'].includes(walletState) ? [{assetId: DEFAULT_PAIR.base.assetId, symbol: "NEAR", decimals: DEFAULT_PAIR.base.decimals, raw: "100000000000000000000000000", amount: "100"}] : []),
    ...(['FundingOnly', 'FundingBalance', 'WithActivity', 'PartialValuation', 'DefaultSourceDrained'].includes(walletState)
      ? [{ assetId: 'storybook:base-usdc', decimals: 6, raw: '250000000', amount: '250' }] : []),
  ] };
}
export async function getTokenMarkets() {
  if (walletState === 'Loading') return pending();
  if (walletState === 'PricesUnavailable') throw new Error('Demo prices unavailable');
  return { updatedAt: Date.now(), assets: {
    [DEFAULT_PAIR.quote.assetId]: { price: 1 },
    ...(walletState === 'PartialValuation' ? {} : { 'storybook:base-usdc': { price: 1 } }),
  } };
}
async function activity() {
  if (walletState === 'Loading') return pending();
  if (walletState === 'ActivityUnavailable') throw new Error('Demo activity unavailable');
}
export async function fundingHistory() { await activity(); return { operations: fundingOperations() }; }
export async function getWithdrawals() {
  await activity();
  return { withdrawals: ['WithActivity', 'InvalidActivityTime'].includes(walletState) ? [{
    id: 'demo-withdrawal', createdAt: walletState === 'InvalidActivityTime' ? 9e15 : Date.now() - 3600000, state: 'settled',
    review: { originAsset: DEFAULT_PAIR.quote.assetId, asset: 'USDC', amount: '50', destinationChain: 'Base' },
  }] : [] };
}
export async function getDeposits() {
  await activity();
  return { deposits: ['WithActivity', 'InvalidActivityTime'].includes(walletState) ? [{
    id: 'demo-deposit', createdAt: walletState === 'InvalidActivityTime' ? 9e15 : Date.now() - 600000, status: 'SUCCESS',
    quote: { asset: 'USDC', amountInFormatted: '250', sourceChain: 'Base' },
  }] : [] };
}
export async function getBridgeDeposits() { await activity(); return { deposits: [] }; }
// Never invoke WebAuthn or the real account service from a story.
export async function unlockBalances() {
  if (walletState === 'UnlockWaiting') return pending();
  if (walletState === 'UnlockCancelled') throw new DOMException('Demo device cancellation', 'NotAllowedError');
  if (walletState === 'UnlockUnavailable') throw new Error('Balance access is temporarily unavailable. Try again.');
  setWalletState('TradingBalance');
}
export function passkeyError(error: unknown) {
  if (error && typeof error === 'object' && (('name' in error && error.name === 'NotAllowedError') || ('code' in error && error.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY')))
    return 'Confirmation wasn’t completed. Please try again.';
  return error instanceof Error ? error.message : 'Unable to confirm your passkey. Please try again.';
}

// Standalone dashboard stories must never perform real session or signing mutations.
const blockedDashboardMutation = async () => { throw new Error("Storybook cannot sign or change wallet sessions."); };
export const loginOptions = blockedDashboardMutation;
export const registrationOptionsRequest = blockedDashboardMutation;
export const verifyLogin = blockedDashboardMutation;
export const verifyRegistration = blockedDashboardMutation;

export const prepareConfidentialAccess = blockedDashboardMutation;
export const unlockConfidentialAccess = blockedDashboardMutation;
export const unlockConfidentialAccessWithBalances = blockedDashboardMutation;

let backupStoryActive = false;
export function setBackupStory(active: boolean) { backupStoryActive = active; }
async function backupOptions() {
  if (!backupStoryActive) return blockedDashboardMutation();
  return { challenge: 'synthetic-backup-challenge' };
}
async function backupVerified() {
  if (!backupStoryActive) return blockedDashboardMutation();
  return { ok: true };
}
export const backupAuthorizationOptions = backupOptions;
export const backupRegistrationOptions = backupOptions;
export const backupTestOptions = backupOptions;
export const verifyBackupAuthorization = backupVerified;
export const verifyBackupRegistration = backupVerified;
export const verifyBackupTest = backupVerified;
export async function signIn() { throw new Error('This preview uses a demo account.'); }
