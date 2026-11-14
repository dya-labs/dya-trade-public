import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityPanel, type ActivityTab } from '@/components/near/activity-panel';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { accountId, setOrdersState, type OrdersState } from './api-mocks';
import { setWalletState } from '../wallet/api-mocks';
import { setTradesState } from '../trades/api-mocks';

function ActivityStory({ tab }: { state: OrdersState; tab: ActivityTab }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [value, change] = useState(tab);
  return <QueryClientProvider client={client}><div className="p-4"><div className="max-w-6xl border"><ActivityPanel accountId={accountId} pair={DEFAULT_PAIR} value={value} onChange={change} openTransfers={() => {}} openDeposit={() => {}} /></div></div></QueryClientProvider>;
}
const meta = {
  title: 'App/TradeActivity', component: ActivityStory,
  args: { state: 'Mixed', tab: 'orders' },
  beforeEach: ({ args }) => { setWalletState("TradingBalance"); setOrdersState(args.state); setTradesState(args.state === 'Empty' || args.state === 'Loading' || args.state === 'Unavailable' ? args.state : 'Mixed'); },
  render: args => <ActivityStory key={`${args.state}:${args.tab}`} {...args} />,
} satisfies Meta<typeof ActivityStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Balances: Story = { args: { tab: "balances" } };
export const OpenOrders: Story = { args: { tab: "orders" } };
export const TradeHistory: Story = { args: { tab: 'my-trades' } };
export const OrderHistory: Story = { args: { tab: 'order-history' } };
export const PartialFill: Story = { args: { state: 'PartiallyFilled' } };
export const Unconfirmed: Story = { args: { state: 'Unconfirmed' } };
export const StatusUnavailable: Story = { args: { state: 'StatusStale' } };
export const Empty: Story = { args: { state: 'Empty' } };

export const TradeHistoryLoading: Story = { args: { tab: 'my-trades', state: 'Loading' } };
export const TradeHistoryEmpty: Story = { args: { tab: 'my-trades', state: 'Empty' } };
export const TradeHistoryUnavailable: Story = { args: { tab: 'my-trades', state: 'Unavailable' } };
export const OrderHistoryLoading: Story = { args: { tab: 'order-history', state: 'Loading' } };
export const OrderHistoryEmpty: Story = { args: { tab: 'order-history', state: 'Empty' } };
export const OrderHistoryUnavailable: Story = { args: { tab: 'order-history', state: 'Unavailable' } };
