// @vitest-environment node
import { expect, it } from 'vitest';
import { orderFillPercent, orderSettlement, orderStatus } from '@/lib/near/domain/order-display';
import { getOrders, setOrdersState } from '@/stories/orders/api-mocks';

it('uses base output for buys and base input for sells, independent of fill count', async () => {
  setOrdersState('Mixed');
  const { orders } = await getOrders();
  const buy = orders[0], sell = orders[1];
  buy.provider!.partialFills = [{ id: 'a', amountIn: '999999999', amountOut: (BigInt(buy.preview.request.data.attributes.quantity) / BigInt(4)).toString() }];
  buy.provider!.fillStatus = 'PARTIALLY_FILLED';
  expect(orderStatus(buy)).toBe('25% filled');
  expect(orderStatus(sell)).toBe('20% filled');
  sell.provider!.partialFills[0].amountOut = '1';
  expect(orderFillPercent(sell)).toBe('20%');
});
it('preserves precision and does not imply completion from rounding', async () => {
  setOrdersState('PartiallyFilled');
  const order = (await getOrders()).orders[0];
  const total = BigInt(order.preview.request.data.attributes.quantity);
  order.provider!.partialFills[0].amountOut = (total - BigInt(1)).toString();
  expect(orderStatus(order)).toBe('99.9% filled');
  order.provider!.partialFills[0].amountOut = '1';
  expect(orderStatus(order)).toBe('<0.1% filled');
  order.provider!.partialFills[0].amountOut = (total + BigInt(1)).toString();
  expect(orderStatus(order)).toBe('Partially filled');
  order.provider!.partialFills = [];
  expect(orderStatus(order)).toBe('Partially filled');
});
it('does not double-count duplicate fills and sums distinct partial fills', async () => {
  setOrdersState('PartiallyFilled');
  const order = (await getOrders()).orders[0];
  order.provider!.partialFills.push({ ...order.provider!.partialFills[0], id: 'second' });
  expect(orderFillPercent(order)).toBe('40%');
  order.provider!.partialFills[1].id = order.provider!.partialFills[0].id;
  expect(orderFillPercent(order)).toBeNull();
});
it('gives cancellation priority and only adds settlement information that needs attention', async () => {
  setOrdersState('Filled');
  const order = (await getOrders()).orders[0];
  expect(orderStatus(order)).toBe('Filled');
  expect(orderSettlement(order)).toBeNull();
  order.provider!.payoutStatus = 'FAILED';
  expect(orderSettlement(order)).toBe('Settlement failed');
  order.provider!.payoutStatus = 'NOT_STARTED'; order.provider!.payoutFinal = false;
  expect(orderSettlement(order)).toBe('Settlement pending');
  order.provider!.fillStatus = 'PENDING_CANCEL';
  expect(orderStatus(order)).toBe('Cancelling');
});
