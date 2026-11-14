import { DEFAULT_PAIR } from '@dya/wallet-contracts/src/domain/catalog';
import { ConfidentialAccessRequired } from '@dya/wallet-contracts/src/domain/confidential-access-error';
export let dashboardMode: 'partial-activity-error' | 'activity-unavailable' | 'signed-out' | 'funded' | 'multi-network' | 'locked' | 'unavailable' | null = null;
export function dashboardScenario(value: typeof dashboardMode) { dashboardMode = value; }
export async function getSession() {
  if (dashboardMode === 'unavailable') throw new Error('Mock connection unavailable');
  return {account: dashboardMode === 'signed-out' ? null : {id:'storybook-account',kind:'passkey' as const},passkeyOrigin:'https://id.example.test'};
}
export async function dashboardBalances() {
  if (dashboardMode === 'locked') throw new ConfidentialAccessRequired();
  if (dashboardMode === 'unavailable') throw new Error('Mock connection unavailable');
  return {accountId:'storybook-wallet',blockHeight:0,checkedAt:1,assets:[{assetId:DEFAULT_PAIR.quote.assetId,symbol:'USDC',decimals:6,raw:'100000000',amount:'100'}, ...(dashboardMode === 'multi-network' ? [{assetId:'storybook:base-usdc',symbol:'USDC',decimals:6,raw:'25000000',amount:'25'}] : [])]};
}
export async function logout() { throw new Error('Storybook does not change real sessions.'); }
