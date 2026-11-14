export let withdrawalState = 'Configure';
let quoteRequests = 0;
export function setWithdrawalState(state: string) { withdrawalState = state; quoteRequests = 0; }
const review = () => ({
  amount: '100', expectedReceive: '99.80', minimumReceive: '98.80', asset: 'USDC',
  destinationChain: 'Base', destinationWallet: '0x1111111111111111111111111111111111111111',
  deadline: new Date(Date.now() + (withdrawalState === 'QuoteExpired' && quoteRequests <= 1 ? -1000 : 120000)).toISOString(),
});
export async function prepareWithdrawal() {
  quoteRequests++;
  if (withdrawalState === 'QuoteUnavailable') throw new Error('Unable to get withdrawal quote. Please try again.');
  return { options: {}, review: review() };
}
export async function startAuthentication() {
  if (withdrawalState === 'PasskeyConfirmation') return new Promise<never>(() => {});
  if (withdrawalState === 'PasskeyCancelled') throw new DOMException('Demo browser cancellation details', 'NotAllowedError');
  return {};
}
export async function submitWithdrawal() {
  return { withdrawal: { id: 'storybook-withdrawal', state: withdrawalState === 'Completed' ? 'settled' : withdrawalState === 'Failed' ? 'failed' : 'submitted', review: review() } };
}
export async function getWithdrawalStatus() {
  if (withdrawalState === 'StatusUnavailable') throw new Error('Demo status unavailable');
  return submitWithdrawal();
}

export async function startRegistration() { return {}; }
