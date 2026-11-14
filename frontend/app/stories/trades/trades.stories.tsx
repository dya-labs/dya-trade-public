import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MarketTrades } from '@/components/near/market-trades';
import { setTradesState, type State } from './api-mocks';

function TradesStory({ state }: { state: State }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retryDelay: 0, refetchOnWindowFocus: false } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>
    <div className="p-4"><div className="max-w-5xl border"><MarketTrades accountId={state === 'SignedOut' ? null : "demo"} /></div></div>
  </QueryClientProvider>;
}
const meta = {
  title: 'App/MyTrades', component: TradesStory,
  args: { state: 'Mixed' }, argTypes: { state: { control: false } },
  beforeEach: context => { setTradesState(context.args.state); return () => setTradesState("Empty"); },
  render: args => <TradesStory key={args.state} {...args} />,
} satisfies Meta<typeof TradesStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Mixed: Story = { args: { state: 'Mixed' } };
export const SignedOut: Story = { args: { state: 'SignedOut' } };
export const Loading: Story = { args: { state: 'Loading' } };
export const Empty: Story = { args: { state: 'Empty' } };
export const Unavailable: Story = { args: { state: 'Unavailable' } };
export const Processing: Story = { args: { state: 'Processing' } };
export const Completed: Story = { args: { state: 'Completed' } };
export const Failed: Story = { args: { state: 'Failed' } };
export const Unconfirmed: Story = { args: { state: 'Unconfirmed' } };
export const StatusUnavailable: Story = { args: { state: 'StatusUnavailable' } };
export const Details: Story = { args: { state: "Completed" }, play: async ({ canvasElement }: { canvasElement: HTMLElement }) => { fireEvent.click(await within(canvasElement).findByRole("row", { name: "View trade details, Completed" })); } };
