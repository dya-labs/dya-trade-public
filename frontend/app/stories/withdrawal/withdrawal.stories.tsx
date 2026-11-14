import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WithdrawalForm } from '@/components/near/withdrawal-form';
import { DialogDrawer, DialogDrawerContent } from '@dya/ui/components/dialog-drawer';
import { Button } from '@dya/ui/components/button';
import { setWithdrawalState } from './api-mocks';
import { setWalletState } from '../wallet/api-mocks';
import { assets } from '../deposit/api-mocks';

function WithdrawalStory({ state }: { state: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [open, setOpen] = useState(true);
  const [details, setDetails] = useState(false);
  const [sourceSpent, setSourceSpent] = useState(false);
  const [catalogChanged, setCatalogChanged] = useState(false);
  return <QueryClientProvider client={client}><div className="p-6"><Button onClick={() => setOpen(true)}>Open withdrawal dialog</Button>{details && <p role="status">Transfer activity selected (Storybook demo)</p>}</div>
    <DialogDrawer open={open} onOpenChange={setOpen}><DialogDrawerContent className="max-h-[85dvh] overflow-y-auto">{['SourceDrained', 'DefaultSourceDrained'].includes(state) && !sourceSpent && <Button onClick={() => { setSourceSpent(true);setWalletState(state === 'DefaultSourceDrained' ? 'DefaultSourceDrained' : 'TradingBalance');void client.invalidateQueries({ queryKey: ['near', 'account', `storybook-withdrawal-${state}`, 'balances'] }); }}>Simulate selected source spent</Button>}{['DestinationRemoved', 'ReviewedDestinationRemoved', 'SourceRemoved', 'ReviewedSourceRemoved'].includes(state) && !catalogChanged && <Button onClick={() => { setCatalogChanged(true);client.setQueryData(['near', 'catalog'], { assets: assets.filter(asset => asset.blockchain !== 'base') }); }}>Simulate catalog change</Button>}<WithdrawalForm accountId={`storybook-withdrawal-${state}`} onClose={() => setOpen(false)} onDetails={() => { setOpen(false); setDetails(true); }} /></DialogDrawerContent></DialogDrawer>
  </QueryClientProvider>;
}
const meta = {
  title: 'Shared/WithdrawalDialog', component: WithdrawalStory,
  args: { state: 'Configure' }, argTypes: { state: { control: false } },
  beforeEach: context => {
    setWithdrawalState(context.args.state);
    setWalletState(context.args.state === 'BalancesUnavailable' ? 'BalancesUnavailable' : context.args.state === 'BalanceRecovery' ? 'BalancesRecoverable' : ['SourceDrained', 'DefaultSourceDrained', 'SourceRemoved', 'ReviewedSourceRemoved'].includes(context.args.state) ? 'FundingBalance' : 'TradingBalance');
    localStorage.removeItem(`withdrawal-recipients:storybook-withdrawal-${context.args.state}:base`);
    if (context.args.state === 'RecentRecipients') localStorage.setItem('withdrawal-recipients:storybook-withdrawal-RecentRecipients:base', JSON.stringify(Array.from({ length: 6 }, (_, i) => `0x${String(i + 1).repeat(40)}`)));
  },
  render: args => <WithdrawalStory key={args.state} {...args} />,
  play: async ({ args }) => {
    const body = within(document.body);
    await waitFor(() => {
      if (body.getByRole('button', { name: 'Withdrawal token' }).hasAttribute('disabled')) throw new Error('Catalog loading');
    });
    if (args.state === 'Configure') return;
    if (args.state === 'TokenSelection') {
      fireEvent.click(await body.findByRole('button', { name: 'Withdrawal token' })); return;
    }
    fireEvent.click(await body.findByRole('button', { name: 'Withdrawal network' }));
    if (args.state === 'NetworkSelection') return;
    fireEvent.click(await body.findByRole('button', { name: ['SourceRemoved', 'ReviewedSourceRemoved'].includes(args.state) ? 'NEAR' : /Base/ }));
    fireEvent.click(body.getByRole('button', { name: 'Next' }));
    if (['Recipient', 'RecentRecipients'].includes(args.state)) return;
    fireEvent.change(body.getByPlaceholderText('Paste recipient address'), { target: { value: '0x1111111111111111111111111111111111111111' } });
    fireEvent.click(body.getByRole('button', { name: 'Next' }));
    if (['SourceRemoved', 'ReviewedSourceRemoved'].includes(args.state)) {
      fireEvent.click(body.getByRole('combobox', { name: 'Source balance' }));
      const base = await body.findByRole('option', { name: 'Base balance' });fireEvent.pointerDown(base);fireEvent.click(base);
      await waitFor(() => { if (body.queryByRole('option', { name: 'Base balance' })) throw new Error('Source popup closing'); });
    }
    fireEvent.change(body.getByLabelText('Amount (USDC)'), { target: { value: args.state === 'InsufficientBalance' ? '2000' : '100' } });
    if (['SourceDrained', 'DefaultSourceDrained'].includes(args.state)) {
      if (args.state === 'SourceDrained') {
      fireEvent.click(body.getByRole('combobox', { name: 'Source balance' }));
      const base = await body.findByRole('option', { name: 'Base balance' });fireEvent.pointerDown(base);fireEvent.click(base);
      await waitFor(() => { if (!body.getByRole('combobox', { name: 'Source balance' }).textContent?.includes('Base')) throw new Error('Source selection pending'); });
      }
      fireEvent.change(body.getByLabelText('Amount (USDC)'), { target: { value: '100' } });
      fireEvent.click(body.getByRole('button', { name: 'Simulate selected source spent' }));return;
    }
    if (['DestinationRemoved', 'SourceRemoved'].includes(args.state)) { fireEvent.click(body.getByRole('button', { name: 'Simulate catalog change' }));return; }
    if (['Amount', 'InsufficientBalance', 'BalancesUnavailable', 'BalanceRecovery'].includes(args.state)) return;
    await waitFor(() => {
      if (body.getByRole('button', { name: 'Review withdrawal' }).hasAttribute('disabled')) throw new Error('Balances loading');
    });
    fireEvent.click(body.getByRole('button', { name: 'Review withdrawal' }));
    if (['ReviewedDestinationRemoved', 'ReviewedSourceRemoved'].includes(args.state)) { await body.findByRole('button', { name: 'Confirm withdrawal' });fireEvent.click(body.getByRole('button', { name: 'Simulate catalog change' }));return; }
    if (['Review', 'QuoteExpired', 'QuoteUnavailable'].includes(args.state)) return;
    fireEvent.click(await body.findByRole('button', { name: 'Confirm withdrawal' }));
  },
} satisfies Meta<typeof WithdrawalStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Configure: Story = {};
export const TokenSelection: Story = { args: { state: 'TokenSelection' } };
export const NetworkSelection: Story = { args: { state: 'NetworkSelection' } };
export const Recipient: Story = { args: { state: 'Recipient' } };
export const RecentRecipients: Story = { args: { state: 'RecentRecipients' } };
export const Amount: Story = { args: { state: 'Amount' } };
export const InsufficientBalance: Story = { args: { state: 'InsufficientBalance' } };
export const BalancesUnavailable: Story = { args: { state: 'BalancesUnavailable' } };
export const BalanceRecovery: Story = { args: { state: 'BalanceRecovery' } };
export const Review: Story = { args: { state: 'Review' } };
export const QuoteExpired: Story = { args: { state: 'QuoteExpired' } };
export const QuoteUnavailable: Story = { args: { state: 'QuoteUnavailable' } };
export const PasskeyConfirmation: Story = { args: { state: 'PasskeyConfirmation' } };
export const PasskeyCancelled: Story = { args: { state: 'PasskeyCancelled' } };
export const Processing: Story = { args: { state: 'Processing' } };
export const Completed: Story = { args: { state: 'Completed' } };
export const Failed: Story = { args: { state: 'Failed' } };
export const StatusUnavailable: Story = { args: { state: 'StatusUnavailable' } };

export const SourceDrained: Story = { args: { state: 'SourceDrained' } };

export const DefaultSourceDrained: Story = { args: { state: 'DefaultSourceDrained' } };

export const DestinationRemoved: Story = { args: { state: 'DestinationRemoved' } };
export const ReviewedDestinationRemoved: Story = { args: { state: 'ReviewedDestinationRemoved' } };

export const SourceRemoved: Story = { args: { state: 'SourceRemoved' } };
export const ReviewedSourceRemoved: Story = { args: { state: 'ReviewedSourceRemoved' } };
