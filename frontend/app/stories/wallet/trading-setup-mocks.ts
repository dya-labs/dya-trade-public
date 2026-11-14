import type { ActivationPublic, ActivationStatus } from '../../../id/lib/outlayer-activation-client';

export const sampleQuote: ActivationPublic = {
  id: 'story-quote', planHash: 'story-plan', phase: 'review', asset: 'USDC',
  maximumPaymentRaw: '1624769', paymentDecimals: 6, requiredYoctoNear: '500000000000000000000000',
  costs: { initializationMax: '0', controllerBalances: '10000000000000000000000', policyStorage: '50000000000000000000000', gasReserve: '440000000000000000000000' },
  controllerId: 'example.near', expiresAt: 0, deliveryAppFeeBps: 20, refundedYoctoNear: '0', txHashes: [],
};

export type Journey = 'create' | 'change-token' | 'resume' | 'uncertain' | 'refund';
export function createScenario(initial: ActivationPublic | null, journey: Journey = 'create') {
  let activation = initial;
  let paymentAsset = initial?.asset ?? 'USDC';
  const status = (): ActivationStatus => ({
    pilotEnabled: true, activation, paymentAsset, canDiscard: !activation || activation.phase === 'review',
  });
  async function advanceActivation() {
    if (activation?.phase === 'payment-pending' || activation?.phase === 'payment-review') {
      activation = { ...activation, phase: 'await-owner' };
    } else if (activation?.phase === 'running') {
      activation = journey === 'refund'
        ? { ...activation, phase: 'refund', outcome: 'failed', refundPhase: 'settling' }
        : { ...activation, phase: 'complete', outcome: 'active' };
    } else if (activation?.refundPhase === 'settling' && activation.outcome === 'active') {
      activation = {
        ...activation,
        phase: 'complete',
        refundedYoctoNear: (BigInt(activation.refundedYoctoNear) + BigInt(activation.refundOwedYoctoNear ?? '0')).toString(),
        refundPhase: undefined,
        refundOwedYoctoNear: undefined,
        reason: undefined,
      };
    } else if (activation?.refundPhase === 'settling') {
      activation = { ...activation, refundPhase: 'owed', refundedYoctoNear: '420000000000000000000000', refundOwedYoctoNear: '1000000000000000000000', reason: 'The remainder is below the refund minimum.' };
    }
    return status();
  }
  const options = async () => ({ options: { challenge: 'storybook-only' } });
  return {
    readActivation: async () => status(),
    async prepareActivationReview(asset: 'USDC' | 'NEAR') {
      if (activation?.phase === 'review') await new Promise<void>(resolve => setTimeout(resolve, 900));
      paymentAsset = asset;
      activation = { ...sampleQuote, asset, expiresAt: Date.now() + 60_000,
        ...(asset === 'NEAR' ? { maximumPaymentRaw: '500000000000000000000000', paymentDecimals: 24 } : {}) };
      return status();
    },
    async saveSetupPaymentAsset(asset: 'USDC' | 'NEAR') { paymentAsset = asset; return status(); },
    async discardSetup() { activation = null; return { ...status(), discarded: true }; },
    advanceActivation,
    async refundActivation() {
      if (activation) activation = { ...activation, phase: 'refund', outcome: activation.outcome ?? 'failed', refundPhase: 'settling' };
      return status();
    },
    rebroadcastActivation: advanceActivation,
    prepareActivationPayment: options,
    prepareActivationOwner: options,
    async submitActivationPayment() {
      if (activation?.phase !== 'review') throw new Error('Setup payment already submitted.');
      activation = { ...activation, phase: journey === 'uncertain' ? 'payment-review' : 'payment-pending' };
      return status();
    },
    async submitActivationOwner() {
      if (activation?.phase !== 'await-owner') throw new Error('Payment must settle first.');
      activation = { ...activation, phase: 'running' };
      return status();
    },
  };
}
