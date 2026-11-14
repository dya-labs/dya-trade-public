import { quantityRaw } from '@/lib/near/domain/catalog';
import { ASSETS } from '@/lib/near/domain/assets';
import { previewLimit } from '@/lib/near/domain/limit-preview';
import type { StoredOrder } from '@/lib/near/http/schemas/trading';

export const ordersStates = ['SignedOut', 'Loading', 'Empty', 'Open', 'PartiallyFilled', 'Filled', 'Cancelled', 'Expired', 'CheckingFunding', 'Unconfirmed', 'CancelPending', 'Cancelling', 'CancelFailed', 'StatusStale', 'Unavailable', 'Mixed', 'Details'] as const;
export type OrdersState = typeof ordersStates[number];
export const accountId = '0x' + 'a'.repeat(40);
const timestamp = Date.parse('2026-10-03T08:00:00Z');
let state: OrdersState = 'Open';
let orders: StoredOrder[] = [];

function makeOrder(id: string, fillStatus: NonNullable<StoredOrder['provider']>['fillStatus'] = 'OPEN', side: 'buy' | 'sell' = 'buy'): StoredOrder {
  const preview = previewLimit({ side, quantity: side === 'buy' ? '125' : '50', price: side === 'buy' ? '4.25' : '4.80', expiryHours: 24 }, {
    accountId, blockHeight: 200_000_000, checkedAt: timestamp,
    assets: ASSETS.map(asset => ({ ...asset, amount: '10000', raw: '1' + '0'.repeat(asset.decimals + 4) })),
  }, timestamp);
  const input = side === 'buy' ? preview.pair.quote : preview.pair.base;
  const fundingAmount = quantityRaw(preview.principal, input.decimals);
  const outputRaw = quantityRaw(side === 'buy' ? preview.quantity : String(Number(preview.quantity) * Number(preview.price)), side === 'buy' ? preview.pair.base.decimals : preview.pair.quote.decimals);
  const divisor = fillStatus === 'PARTIALLY_FILLED' ? BigInt(5) : BigInt(1);
  const filled = ['FILLED', 'PARTIALLY_FILLED'].includes(fillStatus);
  const final = ['FILLED', 'CANCELED', 'EXPIRED'].includes(fillStatus);
  return {
    id, ownerId: accountId, requestId: `request-${id}`, terms: 'Storybook demo', preview: { ...preview, side },
    createdAt: timestamp, updatedAt: timestamp, state: 'created', fundingState: 'submitted',
    provider: {
      id: `provider-${id}`, fillStatus, payoutStatus: final ? 'COMPLETED' : 'NOT_STARTED', payoutFinal: final,
      depositAddress: 'storybook.near', fundingAmount, inputAsset: input.assetId,
      depositedAmount: fillStatus === 'AWAITING_DEPOSIT' ? '0' : fundingAmount,
      partialFills: filled ? [{ id: `fill-${id}-1`, amountIn: (BigInt(fundingAmount) / divisor).toString(), amountOut: (BigInt(outputRaw) / divisor).toString() }] : [],
      ...(fillStatus === 'FILLED' ? { payoutTxHashes: ['7'.repeat(44)] } : {}),
      ...(['CANCELED', 'EXPIRED'].includes(fillStatus) ? { refundTxHash: '8'.repeat(44) } : {}),
    },
  };
}
export function setOrdersState(next: OrdersState) {
  state = next;
  const order = makeOrder('demo-order-1');
  switch (state) {
    case 'SignedOut': case 'Loading': case 'Empty': case 'Unavailable': orders = []; break;
    case 'PartiallyFilled': orders = [makeOrder('demo-order-1', 'PARTIALLY_FILLED')]; break;
    case 'Filled': case 'Details': orders = [makeOrder('demo-order-1', 'FILLED')]; break;
    case 'Cancelled': orders = [makeOrder('demo-order-1', 'CANCELED')]; break;
    case 'Expired': orders = [makeOrder('demo-order-1', 'EXPIRED')]; break;
    case 'CheckingFunding': orders = [{ ...makeOrder('demo-order-1', 'AWAITING_DEPOSIT'), fundingState: 'unknown' }]; break;
    case 'Unconfirmed': orders = [{ ...order, provider: undefined, state: 'unknown', fundingState: 'unknown' }]; break;
    case 'CancelPending': orders = [{ ...order, cancelPending: true }]; break;
    case 'StatusStale': orders = [{ ...order, syncError: 'Unable to refresh order status.' }]; break;
    case 'Mixed': orders = [order, makeOrder('demo-order-2', 'PARTIALLY_FILLED', 'sell'), makeOrder('demo-order-3', 'FILLED'), makeOrder('demo-order-4', 'CANCELED', 'sell'), makeOrder('demo-order-5', 'EXPIRED')]; break;
    default: orders = [order];
  }
}
const pending = () => new Promise<never>(() => {});
export async function getOrders() {
  if (state === 'Loading') return pending();
  if (state === 'Unavailable') throw new Error('Demo order service unavailable');
  return { orders: structuredClone(orders) };
}
export async function getOrderStatus(id: string) {
  const order = orders.find(item => item.id === id);
  if (!order) throw new Error('Demo order not found');
  return { order: structuredClone(order) };
}
export async function cancelOrder(id: string) {
  if (state === 'Cancelling') return pending();
  if (state === 'CancelFailed') throw new Error('Unable to cancel order. Please try again.');
  const index = orders.findIndex(item => item.id === id);
  if (index < 0) throw new Error('Demo order not found');
  const order = orders[index];
  orders[index] = { ...order, cancelPending: true };
  return { order: structuredClone(orders[index]) };
}
export { getMarketTrades, getMarketTradeStatus } from '../trades/api-mocks';
// All trading mutations remain local deterministic fixtures; none can reach an API.
export { previewMarketOrder, previewLimitOrder, prepareMarketOrder, prepareLimitOrder, submitMarketOrder, submitLimitOrder, abandonLimitOrder } from '../trade-entry/api-mocks';
