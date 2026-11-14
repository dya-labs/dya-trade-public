import { DEFAULT_PAIR, quantityRaw } from '@/lib/near/domain/catalog';
import { previewLimit } from '@/lib/near/domain/limit-preview';
import { limitPreview as limitPreviewSchema, type ExecutableLimitReview, type MarketPreview, type StoredOrder } from '@/lib/near/http/schemas/trading';
let state = 'MarketBuy';
let preparations = 0;
let abandonments = 0;
type LimitInput = { side: 'buy' | 'sell'; quantity: string; price: string; expiryHours?: number; requestId?: string };
let lastLimitInput: LimitInput | null = null;
export function setTicketState(value: string) { state = value; preparations = 0; abandonments = 0; lastLimitInput = null; }
export async function previewMarketOrder({ side, quantity }: { side: 'buy' | 'sell'; quantity: string }): Promise<MarketPreview> {
  if (state === 'QuoteUnavailable') throw new Error('Demo unavailable');
  if (state === 'Quoting') return new Promise(() => {});
  return { pair: DEFAULT_PAIR, orderType: 'market', side, quantity, inputSymbol: side === 'buy' ? 'USDC' : 'NEAR', outputSymbol: side === 'buy' ? 'NEAR' : 'USDC', principal: String(Number(quantity) * (side === 'buy' ? 4 : 1)), estimatedOutput: side === 'buy' ? quantity : String(Number(quantity) * 4), minimumOutput: side === 'buy' ? String(Number(quantity) * .99) : String(Number(quantity) * 3.96), available: '1250.50', shortfall: state === 'InsufficientBalance' ? '750' : '0', balanceBlock: 1, slippageBps: 100, expiresAt: '2099-01-01T00:00:00Z', submissionEnabled: false, timeEstimateSeconds: 30 };
}
export async function previewLimitOrder(body: LimitInput) {
  return limitPreviewSchema.parse(previewLimit({ ...body, expiryHours: body.expiryHours ?? 24 }, {
    accountId: '0x' + 'a'.repeat(40), checkedAt: Date.now(), blockHeight: 1,
    assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote].map((asset, i) => ({ ...asset, amount: i === 0 ? '100' : '1250.50', raw: quantityRaw(i === 0 ? '100' : '1250.50', asset.decimals) })),
  }));
}
export async function prepareMarketOrder(body: {side:'buy'|'sell';quantity:string}) {
  preparations++;
  if (state === 'PreparationRecovery' && preparations === 1) throw new Error('Quote service temporarily unavailable. Please try again.');
  return { options: {}, review: { ...await previewMarketOrder(body), expiresAt: state === 'QuoteExpired' && preparations === 1 ? new Date(Date.now() - 1).toISOString() : new Date(Date.now() + 120_000).toISOString(), submissionEnabled: true } };
}
export async function prepareLimitOrder(body: LimitInput) {
  preparations++; lastLimitInput = body;
  if (state === 'LimitPreparing') return new Promise<never>(() => {});
  if (state === 'LimitPreparationRecovery' && preparations === 1) throw new Error('Could not prepare the funding signature. No funding was submitted.');
  const preview = await previewLimitOrder(body);
  const review: ExecutableLimitReview = { ...preview, submissionEnabled: true, orderId: 'demo-limit-order', fundingAmount: preview.principal, fundingExpiresAt: new Date(Date.now() + (state === 'LimitExpired' && preparations === 1 ? -1 : 120_000)).toISOString() };
  return { options: { challenge: 'storybook-only' }, review };
}
export async function submitLimitOrder(): Promise<{ order: StoredOrder }> {
  if (!lastLimitInput) throw new Error('No mocked preparation exists.');
  if (state === 'LimitSubmitting') return new Promise<never>(() => {});
  if (state === 'LimitSubmissionUnconfirmed') throw new Error('Demo transport interruption');
  return { order: { id: 'demo-limit-order', ownerId: 'storybook', requestId: lastLimitInput.requestId ?? 'demo', terms: 'storybook-only', preview: await previewLimitOrder(lastLimitInput), createdAt: Date.now(), updatedAt: Date.now(), state: 'created', fundingState: 'submitted' } };
}
export async function abandonLimitOrder() {
  if (state === 'LimitCloseRecovery' && abandonments++ === 0) throw new Error('Demo cancellation unavailable');
  return { ok: true as const };
}
export async function submitMarketOrder() {
  if (state === 'SubmissionUnconfirmed') throw new Error('Demo transport interruption');
  return { trade: { id:'demo', state:'submitted' } };
}
