import type { StoredOrder } from '../http/schemas/trading';

export function orderFillPercent(order: StoredOrder): string | null {
  const fills = order.provider?.partialFills;
  if (!fills?.length) return null;
  try {
    const total = BigInt(order.preview.request.data.attributes.quantity);
    if (total <= BigInt(0)) return null;
    const seen = new Set<string>();
    let filled = BigInt(0);
    for (const fill of fills) {
      if (seen.has(fill.id)) return null;
      seen.add(fill.id);
      const amount = BigInt(order.preview.side === 'buy' ? fill.amountOut : fill.amountIn);
      if (amount < BigInt(0)) return null;
      filled += amount;
    }
    if (filled > total) return null;
    if (filled === BigInt(0)) return '0%';
    const tenths = filled * BigInt(1000) / total;
    if (tenths === BigInt(0)) return '<0.1%';
    // Only the provider's final fill status should imply completion.
    if (tenths >= BigInt(1000) && order.provider?.fillStatus !== 'FILLED') return null;
    return `${Number(tenths) / 10}%`;
  } catch { return null; }
}
export function orderStatus(order: StoredOrder, cancelling = false): string {
  if (cancelling || order.cancelPending || order.provider?.fillStatus === 'PENDING_CANCEL') return 'Cancelling';
  const status = order.provider?.fillStatus;
  if (status === 'PARTIALLY_FILLED') {
    const percent = orderFillPercent(order);
    return percent ? `${percent} filled` : 'Partially filled';
  }
  if (status === 'AWAITING_DEPOSIT' && order.fundingState) return 'Checking funding';
  if (status === 'CANCELED') return 'Cancelled';
  if (status) return status.charAt(0) + status.slice(1).replaceAll('_', ' ').toLowerCase();
  return ['creating', 'unknown'].includes(order.state) ? 'Unconfirmed' : order.state.charAt(0).toUpperCase() + order.state.slice(1);
}
export function orderSettlement(order: StoredOrder): string | null {
  if (order.syncError) return 'Status unavailable';
  const provider = order.provider;
  if (!provider || provider.payoutStatus === 'COMPLETED') return null;
  if (provider.payoutStatus === 'FAILED') return 'Settlement failed';
  if (['FILLED', 'CANCELED', 'EXPIRED'].includes(provider.fillStatus) && !provider.payoutFinal) return 'Settlement pending';
  return null;
}
