import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render as renderBase, screen, within } from '@testing-library/react';
import { TransferActivity } from '@/components/near/transfer-activity';
import { fixtures, setTransferState } from '@/stories/transfers/api-mocks';
const mock = vi.hoisted(() => ({ query: {} as Record<string, unknown>, refetch: vi.fn(), bridgeRefetch: vi.fn() }));
vi.mock('@/components/near/use-activity', () => ({ useTransfers: () => mock.query }));
vi.mock('@/components/near/bridge-activity', () => ({ useBridgeActivity: () => ({ data: { deposits: [] }, refetch: mock.bridgeRefetch }), BridgeActivity: () => null }));
beforeEach(() => { setTransferState('Mixed'); mock.refetch.mockReset(); mock.query = { data: { ...fixtures(), unavailableIds: [] }, isSuccess: true, refetch: mock.refetch }; });
function render(ui: ReactNode) {
  const client = new QueryClient();
  client.setQueryData(["near", "network-icons", 2], { icons: {} });
  return renderBase(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
function setup(accountId: string | null = 'demo') { render(<TransferActivity accountId={accountId} openTransfers={vi.fn()} openDeposit={vi.fn()} />); }
it('shows an unavailable state without headers or raw errors and supports retry', () => {
  mock.query = { ...mock.query, data: undefined, isSuccess: false, error: new Error('private upstream') };
  setup();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText('Couldn’t load transfers')).toHaveAttribute('role', 'status');
  expect(screen.queryByText('private upstream')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mock.bridgeRefetch).toHaveBeenCalled();
  expect(mock.refetch).toHaveBeenCalledOnce();
});
it('does not present deposit quote amounts as settled amounts and moves recipient into details', () => {
  setup();
  const table = screen.getByRole('table');
  expect(within(table).getByText('-')).toBeInTheDocument();
  expect(within(table).getByText('100.00 USDC')).toBeInTheDocument();
  expect(within(table).queryByText(/0x111/)).toBeNull();
  fireEvent.click(screen.getByRole('row', { name: 'View withdrawal transfer details, Processing' }));
  expect(within(screen.getByRole('dialog')).getByText(/0x111/)).toBeInTheDocument();
});
it('shows failed status refresh as unavailable with recovery', () => {
  mock.query.data = { ...fixtures(), unavailableIds: ['demo-withdrawal'] };
  setup();
  expect(screen.getByText('Status unavailable')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
  expect(mock.refetch).toHaveBeenCalledOnce();
});
it('keeps unsubmitted deposit instructions outside the activity table', () => {
  setTransferState('Instructions'); mock.query.data = fixtures();
  setup();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('Deposit instructions (1)')).toBeNull();
  expect(screen.getByText('No transfers yet.')).toBeInTheDocument();
});
it('omits table headers when signed out', () => {
  setup(null);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText('Connect a passkey to view transfers.')).toBeInTheDocument();
});
it.each([['Processing', 'Processing'], ['Completed', 'Completed'], ['Failed', 'Failed'], ['Unconfirmed', 'Unconfirmed'], ['StatusUnavailable', 'Status unavailable']] as const)('announces the current %s transfer status in its accessible row', (state, label) => {
  setTransferState(state); mock.query.data = { ...fixtures(), unavailableIds: state === 'StatusUnavailable' ? ['demo-withdrawal'] : [] };
  setup();
  expect(screen.getByRole('row', { name: `View withdrawal transfer details, ${label}` })).toBeVisible();
});
it.each(['deposit', 'withdrawal'] as const)('keeps a %s with an invalid timestamp usable in the table and details', kind => {
  const data = fixtures();
  const item = kind === 'deposit' ? data.deposits[0] : data.withdrawals[0];
  item.createdAt = 9e15;
  mock.query.data = { ...data, unavailableIds: [] };
  setup();
  expect(within(screen.getByRole('table')).getByTitle('Time unavailable')).toHaveTextContent('-');
  fireEvent.click(screen.getByRole('row', { name: new RegExp(`View ${kind} transfer details,`) }));
  const dialog = screen.getByRole('dialog', { name: new RegExp(`${kind === 'deposit' ? 'Deposit' : 'Withdrawal'} ·`) });
  expect(within(dialog).getByTitle('Time unavailable')).toHaveTextContent('-');
  expect(within(dialog).queryByText(item.id)).toBeNull();
});

it.each([undefined, '0', '98.5'] as const)('shows only the reported credited deposit amount %s after settlement', creditedAmount => {
  setTransferState('Completed');
  const data = fixtures();
  data.deposits[0] = { ...data.deposits[0], creditedAmount, quote: { ...data.deposits[0].quote, amountInFormatted: '123.45', amountOutFormatted: '122.99' } };
  mock.query.data = { ...data, unavailableIds: [] };
  setup();
  const row = within(screen.getByRole('table')).getAllByRole('row').find(row => within(row).queryByText('Deposit'))!;
  expect(within(row).getByText(creditedAmount === undefined ? '-' : `${Number(creditedAmount).toFixed(2)} USDC`)).toBeVisible();
  expect(row).toHaveAccessibleName('View deposit transfer details, Completed');
  expect(screen.queryByText(/123\.45|122\.99/)).toBeNull();
});

it('retains the credited deposit amount through status refresh failure and recovery', () => {
  setTransferState('Completed');
  const data = fixtures(); data.deposits[0].creditedAmount = '98.5';
  mock.query.data = { ...data, unavailableIds: [] };
  const view = render(<TransferActivity accountId="demo" openTransfers={vi.fn()} openDeposit={vi.fn()} />);
  expect(screen.getByText('98.50 USDC')).toBeVisible();
  mock.query = { ...mock.query, data: { ...data, unavailableIds: ['demo-deposit'] }, error: new Error('private provider response') };
  view.rerender(<TransferActivity accountId="demo" openTransfers={vi.fn()} openDeposit={vi.fn()} />);
  expect(screen.getByText('98.50 USDC')).toBeVisible();
  expect(screen.getByRole('row', { name: 'View deposit transfer details, Status unavailable' })).toBeVisible();
  expect(screen.queryByText('private provider response')).toBeNull();
  const depositRow = screen.getByRole('row', { name: 'View deposit transfer details, Status unavailable' }).closest('tr')!;
  fireEvent.click(within(depositRow).getByRole('button', { name: 'Check status' })); expect(mock.refetch).toHaveBeenCalledOnce();
  mock.query = { ...mock.query, data: { ...data, unavailableIds: [] }, error: null };
  view.rerender(<TransferActivity accountId="demo" openTransfers={vi.fn()} openDeposit={vi.fn()} />);
  expect(screen.getByText('98.50 USDC')).toBeVisible();
  expect(screen.getByRole('row', { name: 'View deposit transfer details, Completed' })).toBeVisible();
  expect(screen.queryByText('Unable to refresh transfers.')).toBeNull();
});
