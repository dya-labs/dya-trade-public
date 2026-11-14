import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Orders } from '@/components/near/orders';
import { getOrders, setOrdersState } from '@/stories/orders/api-mocks';
import type { StoredOrder } from '@/lib/near/http/schemas/trading';
const mock = vi.hoisted(() => ({ data: [] as StoredOrder[], isSuccess: true, error: null as Error | null, refetch: vi.fn(), cancel: vi.fn() }));
vi.mock('@/components/near/use-activity', () => ({ useMarketTrades: () => ({ data: [], isSuccess: true }), useOrders: () => ({ data: mock.data, isSuccess: mock.isSuccess, error: mock.error, isPending: false, isFetching: false, refetch: mock.refetch }) }));
vi.mock('@/lib/near/http/trading-client', () => ({ cancelOrder: (...args: unknown[]) => mock.cancel(...args) }));
function setup() { render(<QueryClientProvider client={new QueryClient()}><Orders accountId="demo" /></QueryClientProvider>); }
beforeEach(() => { mock.data = []; mock.isSuccess = true; mock.error = null; mock.cancel.mockReset(); mock.refetch.mockReset(); });
it('omits headings, counts and table headers when empty or unavailable and supports retry', async () => {
  mock.isSuccess = false; mock.error = new Error('upstream');
  setup();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('0 orders')).toBeNull();
  expect(screen.getByText('Couldn’t load orders')).toHaveAttribute('role', 'status');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mock.refetch).toHaveBeenCalledOnce();
});
it('shows a clean empty state', () => {
  setup();
  expect(screen.getByText('No orders yet.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});
it('shows filled percentages without a fills column or completed payout copy', async () => {
  setOrdersState('Mixed'); mock.data = (await getOrders()).orders;
  setup();
  expect(screen.getByText('20% filled')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Fills' })).toBeNull();
  expect(screen.queryByText('Payout completed')).toBeNull();
  expect(screen.getAllByText('NEAR/USDC')).toHaveLength(5);
});
it('keeps cancellation errors with their order and checks status before re-enabling cancellation', async () => {
  setOrdersState('Open'); mock.data = (await getOrders()).orders;
  mock.cancel.mockRejectedValue(new Error('sensitive upstream error'));
  mock.refetch.mockResolvedValue({ isSuccess: true, data: mock.data });
  setup();
  fireEvent.click(screen.getByRole('button', { name: /Cancel buy/ }));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Cancellation unconfirmed');
  const row = status.closest('tr')!;
  expect(within(row).getByRole('button', { name: 'Check status' })).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Open')).toBeNull();
  expect(screen.queryByText('sensitive upstream error')).toBeNull();
  expect(screen.queryByRole('button', { name: /Cancel buy/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
  await screen.findByRole('button', { name: /Cancel buy/ });
  expect(mock.cancel).toHaveBeenCalledOnce();
});
it('shows focused details without internal IDs or absent-transaction explanations', async () => {
  setOrdersState('Open'); mock.data = (await getOrders()).orders;
  setup();
  fireEvent.click(screen.getByRole('row', { name: /View buy .*order details/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Limit buy · Open' })).toBeVisible();
  expect(within(dialog).queryByText('Order reference')).toBeNull();
  expect(within(dialog).queryByText(mock.data[0].id)).toBeNull();
  expect(within(dialog).queryByText(mock.data[0].provider!.id)).toBeNull();
  expect(within(dialog).queryByText(/has not reported/)).toBeNull();
});
it('shows stale status once with recovery and keeps the old status in details', async () => {
  setOrdersState('StatusStale'); mock.data = (await getOrders()).orders;
  mock.refetch.mockResolvedValue({ isSuccess: true, data: mock.data });
  setup();
  expect(screen.getByRole('status')).toHaveTextContent('Status unavailable');
  expect(screen.queryByText('Open')).toBeNull();
  expect(screen.queryByRole('button', { name: /Cancel buy/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
  expect(mock.refetch).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: /Cancel buy/ })).toBeNull();
  fireEvent.click(screen.getByRole('row', { name: /View buy .*order details/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Last known status')).toBeInTheDocument();
  expect(within(dialog).getByText('Open')).toBeInTheDocument();
  expect(within(dialog).getAllByText('Status unavailable')).toHaveLength(1);
});
it('offers a status check for an unconfirmed order without allowing cancellation', async () => {
  setOrdersState('Unconfirmed'); mock.data = (await getOrders()).orders;
  setup();
  expect(screen.getByText('Unconfirmed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Cancel buy/ })).toBeNull();
});

it('preserves existing orders when refreshing fails', async () => {
  setOrdersState('Open'); mock.data = (await getOrders()).orders;
  mock.isSuccess = false; mock.error = new Error('upstream');
  setup();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getByText('Updates delayed')).toBeInTheDocument();
  expect(screen.queryByText('Unable to load orders')).toBeNull();
});
it.each([['Open', 'Open'], ['PartiallyFilled', '20% filled'], ['Filled', 'Filled'], ['CancelPending', 'Cancelling'], ['StatusStale', 'Status unavailable'], ['Unconfirmed', 'Unconfirmed']] as const)('announces the current %s order status in its accessible details action', async (state, label) => {
  setOrdersState(state); mock.data = (await getOrders()).orders;
  setup();
  expect(within(screen.getByRole('row', { name: /View buy .*order details/ })).getByText(label)).toBeVisible();
});

it.each(['request failed', 'order status unavailable'] as const)('retains unconfirmed cancellation when the follow-up %s', async failure => {
  setOrdersState('Open');mock.data = (await getOrders()).orders;
  mock.cancel.mockRejectedValue(new Error('synthetic upstream cancel error'));
  mock.refetch.mockImplementation(async () => ({ isSuccess: failure !== 'request failed', data: mock.data.map(order => ({ ...order, ...(failure === 'order status unavailable' ? { syncError: 'Unable to refresh order status.' } : {}) })) }));
  setup();fireEvent.click(screen.getByRole('button', { name: /Cancel buy/ }));
  expect(await screen.findByRole('status')).toHaveTextContent('Cancellation unconfirmed');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check status' })); });
  expect(screen.getByRole('status')).toHaveTextContent('Cancellation unconfirmed');
  expect(screen.queryByRole('button', { name: /Cancel buy/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check status' })).toBeVisible();expect(mock.cancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/synthetic upstream/)).not.toBeInTheDocument();
});
it.each([['CancelPending', 'Cancelling'], ['Cancelled', 'Cancelled']] as const)('resolves uncertain cancellation to %s without sending another cancel', async (state, label) => {
  setOrdersState('Open');mock.data = (await getOrders()).orders;
  mock.cancel.mockRejectedValue(new Error('synthetic unknown cancellation'));
  mock.refetch.mockImplementation(async () => { setOrdersState(state);mock.data = (await getOrders()).orders;return { isSuccess: true, data: mock.data }; });
  setup();fireEvent.click(screen.getByRole('button', { name: /Cancel buy/ }));
  expect(await screen.findByRole('status')).toHaveTextContent('Cancellation unconfirmed');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check status' })); });
  expect(screen.queryByText('Cancellation unconfirmed')).not.toBeInTheDocument();
  expect(screen.getByText(label)).toBeVisible();expect(screen.queryByRole('button', { name: /Cancel buy/ })).not.toBeInTheDocument();expect(mock.cancel).toHaveBeenCalledTimes(1);expect(mock.refetch).toHaveBeenCalledTimes(1);
});
