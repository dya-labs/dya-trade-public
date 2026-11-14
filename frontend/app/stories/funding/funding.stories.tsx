import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FundingDialog } from '@/components/near/funding-dialog';
import { DialogDrawer, DialogDrawerContent } from '@dya/ui/components/dialog-drawer';
import { Button } from '@dya/ui/components/button';
import { setWalletState } from '../wallet/api-mocks';
import { setWithdrawalState } from '../withdrawal/api-mocks';
import { setFundingScenario, seedFundingScenario, failNextFundingHistory } from './api-mocks';
function FundingStory({ state }: { state: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [open, setOpen] = useState(true);
  const [settled, setSettled] = useState(false);
  return <QueryClientProvider client={client}><div className="p-6"><Button onClick={() => setOpen(true)}>Open transfer dialog</Button></div><DialogDrawer open={open} onOpenChange={setOpen}><DialogDrawerContent className="max-h-[85dvh] overflow-y-auto">{state === 'ResumedProcessing' && !settled && <Button onClick={() => { setSettled(true);seedFundingScenario('Completed');void client.invalidateQueries({ queryKey: ['near', 'account', `storybook-funding-${state}`, 'funding'] }); }}>Simulate resumed transfer settlement</Button>}{state === 'CompletedRefreshUnavailable' && !settled && <Button onClick={async () => { setSettled(true);seedFundingScenario('Completed');await client.invalidateQueries({ queryKey: ['near', 'account', `storybook-funding-${state}`, 'funding'] });failNextFundingHistory();await client.invalidateQueries({ queryKey: ['near', 'account', `storybook-funding-${state}`, 'funding'] }); }}>Simulate completed refresh failure</Button>}<FundingDialog accountId={`storybook-funding-${state}`} onComplete={() => setOpen(false)} onDetails={() => setOpen(false)} /></DialogDrawerContent></DialogDrawer></QueryClientProvider>;
}
const meta = {
  title: 'App/FundingDialog', component: FundingStory, args: { state: 'Selection' },
  argTypes: { state: { control: false } },
  beforeEach: ({ args }) => {
    setWalletState(args.state === 'Empty' ? 'Empty' : args.state === 'Loading' ? 'Loading' : args.state === 'Unavailable' ? 'BalancesUnavailable' : 'FundingBalance');
    setWithdrawalState('Configure');
    if (['ResumedProcessing', 'CompletedRefreshUnavailable'].includes(args.state)) seedFundingScenario('Processing');
    else setFundingScenario(args.state);
  },
  render: args => <FundingStory key={args.state} {...args} />,
  play: async ({ args }) => {
    if (['Selection', 'Empty', 'Loading', 'Unavailable', 'ResumedProcessing', 'CompletedRefreshUnavailable'].includes(args.state)) return;
    const body = within(document.body);
    await waitFor(() => { if (body.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')) throw new Error('Loading balances'); });
    fireEvent.click(body.getByRole('button', { name: 'Continue' }));

  },
} satisfies Meta<typeof FundingStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Selection: Story = {};
export const Empty: Story = { args: { state: 'Empty' } };
export const Loading: Story = { args: { state: 'Loading' } };
export const Unavailable: Story = { args: { state: 'Unavailable' } };
export const Review: Story = { args: { state: 'Review' } };
export const Expired: Story = { args: { state: 'Expired' } };
export const QuoteUnavailable: Story = { args: { state: 'QuoteUnavailable' } };
export const Confirmation: Story = { args: { state: 'Confirmation' } };
export const Processing: Story = { args: { state: 'Processing' } };
export const Completed: Story = { args: { state: 'Completed' } };
export const Partial: Story = { args: { state: 'Partial' } };
export const Failed: Story = { args: { state: 'Failed' } };
export const Unknown: Story = { args: { state: 'Unknown' } };
export const Cancelled: Story = { args: { state: 'Cancelled' } };
export const StatusUnavailable: Story = { args: { state: 'StatusUnavailable' } };

export const ResumedProcessing: Story = { args: { state: 'ResumedProcessing' } };

export const CompletedRefreshUnavailable: Story = { args: { state: 'CompletedRefreshUnavailable' } };

export const FirstUse: Story = { args: { state: "Selection" }, beforeEach: () => { localStorage.removeItem("dya:funding-trading-guide:v1:storybook-funding-Selection"); } };
