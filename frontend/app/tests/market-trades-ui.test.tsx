import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MarketTrades } from '@/components/near/market-trades';
import { fixtures, setTradesState } from '@/stories/trades/api-mocks';
const mock = vi.hoisted(() => ({ query: {} as Record<string, unknown>, refetch: vi.fn() }));
vi.mock('@/components/near/use-activity', () => ({ useMarketTrades: () => mock.query }));
beforeEach(() => { setTradesState('Mixed'); mock.refetch.mockReset(); mock.query = { data: fixtures(), isSuccess: true, refetch: mock.refetch }; });
it('keeps quote minimums out of the table and labels estimates in details', () => {
  render(<MarketTrades accountId="demo" />);
  expect(screen.queryByRole('columnheader', { name: /Min/ })).toBeNull();
  expect(screen.queryByText('3 trades')).toBeNull();
  fireEvent.click(screen.getByRole('row', { name: 'View trade details, Completed' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Estimated output')).toBeInTheDocument();
  expect(within(dialog).getByText('Minimum received')).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'Transaction 1' })).toHaveAttribute('rel', 'noopener noreferrer');
});
it('shows a recoverable unavailable state without raw errors or headers', () => {
  mock.query = { ...mock.query, data: undefined, isSuccess: false, error: new Error('private error') };
  render(<MarketTrades accountId="demo" />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load trades');
  expect(screen.queryByText('private error')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mock.refetch).toHaveBeenCalledOnce();
});
it('replaces stale statuses and provides a status check', () => {
  mock.query.data = [ { ...fixtures()[0], syncError: true } ];
  render(<MarketTrades accountId="demo" />);
  expect(screen.getByText('Status unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Completed')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
  expect(mock.refetch).toHaveBeenCalledOnce();
});
it('omits the table while signed out', () => {
  render(<MarketTrades accountId={null} />);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText('Connect a passkey to view your trades.')).toBeInTheDocument();
});
it.each([['Processing', 'Processing'], ['Completed', 'Completed'], ['Failed', 'Failed'], ['Unconfirmed', 'Unconfirmed'], ['StatusUnavailable', 'Status unavailable']] as const)('announces the current %s trade status in its accessible details action', (state, label) => {
  setTradesState(state); mock.query.data = fixtures().map(trade => ({ ...trade, syncError: state === 'StatusUnavailable' }));
  render(<MarketTrades accountId="demo" />);
  expect(screen.getByRole('row', { name: `View trade details, ${label}` })).toBeVisible();
});
