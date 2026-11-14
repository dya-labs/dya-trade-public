import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Orders } from '@/components/near/orders';
import { setTradesState } from '../trades/api-mocks';
import { accountId, setOrdersState, type OrdersState } from './api-mocks';

function OrdersStory({ state, mode = "all" }: { state: OrdersState; mode?: "all" | "open" }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retryDelay: 0, refetchOnWindowFocus: false } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>
    <div className="p-4"><div className="max-w-5xl border"><Orders mode={mode} accountId={state === 'SignedOut' ? null : accountId} /></div></div>
  </QueryClientProvider>;
}
const meta = {
  title: 'App/Orders', component: OrdersStory,
  args: { state: 'Open' }, argTypes: { state: { control: false } },
  beforeEach: context => { setOrdersState(context.args.state); setTradesState('Mixed'); },
  render: args => <OrdersStory key={args.state} {...args} />,
} satisfies Meta<typeof OrdersStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Open: Story = {};
export const SignedOut: Story = { args: { state: 'SignedOut' } };
export const Loading: Story = { args: { state: 'Loading' } };
export const Empty: Story = { args: { state: 'Empty' } };
export const PartiallyFilled: Story = { args: { state: 'PartiallyFilled' } };
export const Filled: Story = { args: { state: 'Filled' } };
export const Cancelled: Story = { args: { state: 'Cancelled' } };
export const Expired: Story = { args: { state: 'Expired' } };
export const CheckingFunding: Story = { args: { state: 'CheckingFunding' } };
export const Unconfirmed: Story = { args: { state: 'Unconfirmed' } };
export const CancelPending: Story = { args: { state: 'CancelPending' } };
export const Cancelling: Story = {
  args: { state: 'Cancelling' },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => { fireEvent.click(await within(canvasElement).findByRole('button', { name: /Cancel buy order/ })); },
};
export const CancelFailed: Story = {
  args: { state: 'CancelFailed' },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => { fireEvent.click(await within(canvasElement).findByRole('button', { name: /Cancel buy order/ })); },
};
export const StatusStale: Story = { args: { state: 'StatusStale' } };
export const Unavailable: Story = { args: { state: 'Unavailable' } };
export const Mixed: Story = { args: { state: 'Mixed' } };
export const Details: Story = {
  args: { state: 'Details' },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => { fireEvent.click(await within(canvasElement).findByRole('row', { name: 'View buy NEAR order details' })); },
};

export const PendingMarketTrades: Story = { args: { state: 'Open', mode: 'open' } };
