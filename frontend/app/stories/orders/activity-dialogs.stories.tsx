import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Orders } from '@/components/near/orders';
import { OrderHistory } from '@/components/near/order-history';
import { TradeHistory } from '@/components/near/trade-history';
import { TransferActivity } from '@/components/near/transfer-activity';
import { accountId, setOrdersState, type OrdersState } from './api-mocks';
import { setTradesState, type State as TradesState } from '../trades/api-mocks';
import { setTransferState, type State as TransfersState } from '../transfers/api-mocks';
import { setWalletState } from '../wallet/api-mocks';

type Props = {
  view: 'orders' | 'order-history' | 'executions' | 'transfers';
  orders: OrdersState;
  trades: TradesState;
  transfers: TransfersState;
  row: string;
};
function ActivityDialogs({ view }: Props) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}><div className="p-4"><div className="max-w-6xl border">
    {view === 'orders' && <Orders accountId={accountId} mode="open" />}
    {view === 'order-history' && <OrderHistory accountId={accountId} />}
    {view === 'executions' && <TradeHistory accountId={accountId} />}
    {view === 'transfers' && <TransferActivity accountId={accountId} openTransfers={() => {}} openDeposit={() => {}} />}
  </div></div></QueryClientProvider>;
}
const meta = {
  title: 'App/Activity dialogs', component: ActivityDialogs,
  args: { view: 'orders', orders: 'Open', trades: 'Empty', transfers: 'Empty', row: 'View buy NEAR order details' },
  argTypes: { row: { control: false } },
  beforeEach: ({ args }) => {
    setWalletState('TradingBalance'); setOrdersState(args.orders); setTradesState(args.trades); setTransferState(args.transfers);
    return () => { setTradesState('Empty'); setTransferState(null); };
  },
  render: args => <ActivityDialogs key={JSON.stringify(args)} {...args} />,
  play: async ({ canvasElement, args }) => {
    const rows = await within(canvasElement).findAllByRole('row', { name: new RegExp(args.row) });
    fireEvent.click(rows[0]);
    await within(canvasElement.ownerDocument.body).findByRole('dialog');
  },
} satisfies Meta<typeof ActivityDialogs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LimitOpen: Story = {};
export const LimitPartiallyFilled: Story = { args: { orders: 'PartiallyFilled' } };
export const LimitUnconfirmed: Story = { args: { orders: 'Unconfirmed' } };
export const LimitCheckingFunding: Story = { args: { orders: 'CheckingFunding' } };
export const LimitCancelPending: Story = { args: { orders: 'CancelPending' } };
export const LimitStatusUnavailable: Story = { args: { orders: 'StatusStale' } };
export const LimitFilled: Story = { args: { view: 'order-history', orders: 'Filled', row: 'View limit buy order history details' } };
export const LimitCancelled: Story = { args: { view: 'order-history', orders: 'Cancelled', row: 'View limit buy order history details' } };
export const LimitExpired: Story = { args: { view: 'order-history', orders: 'Expired', row: 'View limit buy order history details' } };
export const MarketProcessing: Story = { args: { orders: 'Empty', trades: 'Processing', row: 'View market buy NEAR order details' } };
export const MarketUnconfirmed: Story = { args: { orders: 'Empty', trades: 'Unconfirmed', row: 'View market buy NEAR order details' } };
export const MarketCompleted: Story = { args: { view: 'order-history', orders: 'Empty', trades: 'Completed', row: 'View market buy order history details' } };
export const MarketFailed: Story = { args: { view: 'order-history', orders: 'Empty', trades: 'Failed', row: 'View market buy order history details' } };
export const LimitExecution: Story = { args: { view: 'executions', orders: 'PartiallyFilled', row: 'View limit buy NEAR execution' } };
export const MarketExecutionAmountsUnavailable: Story = { args: { view: 'executions', orders: 'Empty', trades: 'Completed', row: 'View market buy NEAR execution' } };
export const DepositCompleted: Story = { args: { view: 'transfers', transfers: 'Completed', row: 'View deposit transfer details' } };
export const DepositProcessing: Story = { args: { view: 'transfers', transfers: 'Processing', row: 'View deposit transfer details' } };
export const DepositFailed: Story = { args: { view: 'transfers', transfers: 'Failed', row: 'View deposit transfer details' } };
export const DepositRefunded: Story = { args: { view: 'transfers', transfers: 'Refunded', row: 'View deposit transfer details' } };
export const DepositIncomplete: Story = { args: { view: 'transfers', transfers: 'Incomplete', row: 'View deposit transfer details' } };
export const WithdrawalCompleted: Story = { args: { view: 'transfers', transfers: 'Completed', row: 'View withdrawal transfer details' } };
export const WithdrawalProcessing: Story = { args: { view: 'transfers', transfers: 'Processing', row: 'View withdrawal transfer details' } };
export const WithdrawalFailed: Story = { args: { view: 'transfers', transfers: 'Failed', row: 'View withdrawal transfer details' } };
export const WithdrawalUnconfirmed: Story = { args: { view: 'transfers', transfers: 'Unconfirmed', row: 'View withdrawal transfer details' } };
export const WithdrawalStatusUnavailable: Story = { args: { view: 'transfers', transfers: 'StatusUnavailable', row: 'View withdrawal transfer details' } };
export const DirectDeposit: Story = { args: { view: 'transfers', transfers: 'DirectDeposits', row: 'View direct deposit 1 details' } };
