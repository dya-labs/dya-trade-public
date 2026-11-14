import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LegacyDepositForm } from '@/components/near/transfers';
import { DialogDrawer, DialogDrawerContent } from '@dya/ui/components/dialog-drawer';
import { Button } from '@dya/ui/components/button';
import { assets, quote, setScenario } from './api-mocks';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';

function DepositStory({ state }: { state: string }) {
  const [client] = useState(() => {
    const value = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    if (state === 'UNAVAILABLE') { value.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } }); value.setQueryData(['near', 'catalog'], { assets, tokens: [], networks: [] }); }
    if (state === 'TOKEN_REMOVED') value.setQueryData(['near', 'catalog'], { assets: [...assets, DEFAULT_PAIR.base] });
    return value;
  });
  const [removed, setRemoved] = useState(false);
  const [open, setOpen] = useState(true);
  const [deadline] = useState(() => new Date(Date.now() + 15 * 60_000).toISOString());
  const initialQuote = ['UNAVAILABLE', 'INTRO', 'CONFIGURE', 'PREPARE_ERROR', 'PREPARE_RECOVERY', 'TOKEN_REMOVED', 'PREPARE_REFUND_PENDING', 'PREPARE_LOADING'].includes(state) ? null : { ...quote, deadline, ...(state === 'EXPIRED' ? { deadline: '2020-01-01T00:00:00.000Z' } : {}), ...(state === 'REQUIRED_MEMO' ? { depositMemo: 'DEMO-MEMO-12345' } : {}) };
  return <QueryClientProvider client={client}><div className="space-y-2 p-6"><p className="text-xs text-muted-foreground">Storybook sample address · do not send funds</p><Button onClick={() => setOpen(true)}>Open deposit dialog</Button></div><DialogDrawer open={open} onOpenChange={setOpen}><DialogDrawerContent className="max-h-[85dvh] overflow-y-auto">{state === 'TOKEN_REMOVED' && !removed && <Button onClick={() => { setRemoved(true);client.setQueryData(['near', 'catalog'], { assets }); }}>Simulate selected token removed</Button>}<LegacyDepositForm accountId="storybook" initialQuote={initialQuote} onClose={() => setOpen(false)} onDetails={() => setOpen(false)} /></DialogDrawerContent></DialogDrawer></QueryClientProvider>;
}
const meta = {
  title: 'Shared/DepositDialog', component: DepositStory,
  args: { state: 'INTRO' },
  argTypes: { state: { control: false } },
  beforeEach: (context) => { setScenario(['INTRO', 'CONFIGURE', 'EXPIRED', 'REQUIRED_MEMO'].includes(context.args.state) ? 'PENDING_DEPOSIT' : context.args.state); },
  render: args => <DepositStory key={args.state} {...args} />,
} satisfies Meta<typeof DepositStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Important: Story = {};
export const Unavailable: Story = { args: { state: 'UNAVAILABLE' } };
export const Configure: Story = {
  args: { state: 'CONFIGURE' },
  play: async () => {
    const body = within(document.body);
    await fireEvent.click(await body.findByRole('checkbox'));
    await fireEvent.click(body.getByRole('button', { name: /^Continue$/ }));
  },
};
export const AwaitingDeposit: Story = { args: { state: 'PENDING_DEPOSIT' } };
export const Checking: Story = { args: { state: 'CHECKING' } };
export const Processing: Story = { args: { state: 'PROCESSING' } };
export const Completed: Story = { args: { state: 'SUCCESS' } };
export const Failed: Story = { args: { state: 'FAILED' } };
export const Refunded: Story = { args: { state: 'REFUNDED' } };
export const Incomplete: Story = { args: { state: 'INCOMPLETE_DEPOSIT' } };
export const Expired: Story = { args: { state: 'EXPIRED' } };
export const StatusUnavailable: Story = { args: { state: 'STATUS_ERROR' } };
export const CachedStatusUnavailable: Story = { args: { state: 'CACHED_STATUS_ERROR' } };
export const RequiredMemo: Story = { args: { state: 'REQUIRED_MEMO' } };
export const ClipboardRestricted: Story = {
  args: { state: 'REQUIRED_MEMO' },
  render: () => <iframe title="Clipboard-restricted deposit instructions" className="h-[568px] w-full border-0" allow="clipboard-write 'none'" src="iframe.html?id=shared-depositdialog--required-memo&viewMode=story&globals=theme:dark" />,
};
export const QuoteUnavailable: Story = {
  args: { state: 'PREPARE_ERROR' },
  play: async () => {
    const body = within(document.body);
    fireEvent.click(await body.findByRole('checkbox'));
    fireEvent.click(body.getByRole('button', { name: 'Continue' }));
    await waitFor(() => { if (body.getByRole('button', { name: 'Deposit network' }).hasAttribute('disabled')) throw new Error('Catalog loading'); });
    fireEvent.click(body.getByRole('button', { name: 'Deposit network' }));
    fireEvent.click(body.getByRole('button', { name: 'Base' }));
    fireEvent.click(body.getByRole('button', { name: 'Create deposit address' }));
  },
};
export const QuoteRecovery: Story = { args: { state: 'PREPARE_RECOVERY' }, play: QuoteUnavailable.play };

export const TokenRemoved: Story = {
  args: { state: 'TOKEN_REMOVED' },
  play: async () => {
    const body = within(document.body);
    fireEvent.click(await body.findByRole('checkbox'));
    fireEvent.click(body.getByRole('button', { name: 'Continue' }));
    await waitFor(() => { if (body.getByRole('button', { name: 'Deposit token' }).hasAttribute('disabled')) throw new Error('Catalog loading'); });
    fireEvent.click(body.getByRole('button', { name: 'Deposit token' }));
    fireEvent.click(body.getByRole('button', { name: 'NEAR' }));
    fireEvent.click(body.getByRole('button', { name: 'Simulate selected token removed' }));
  },
};

export const RefundRequestPending: Story = {
  args: { state: 'PREPARE_REFUND_PENDING' },
  play: async () => {
    const body = within(document.body);
    fireEvent.click(await body.findByRole('checkbox'));
    fireEvent.click(body.getByRole('button', { name: 'Continue' }));
    await waitFor(() => { if (body.getByRole('button', { name: 'Deposit network' }).hasAttribute('disabled')) throw new Error('Catalog loading'); });
    fireEvent.click(body.getByRole('button', { name: 'Deposit network' }));
    fireEvent.click(body.getByRole('button', { name: 'NEAR' }));
    fireEvent.change(body.getByLabelText('Refund address on NEAR'), { target: { value: 'alice.near' } });
    fireEvent.click(body.getByRole('button', { name: 'Create deposit address' }));
  },
};

export const CreatingAddress: Story = {
  args: { state: 'PREPARE_LOADING' },
  play: async () => {
    const body = within(document.body);
    await fireEvent.click(await body.findByRole('checkbox'));
    await fireEvent.click(body.getByRole('button', { name: /^Continue$/ }));
  },
};

export const ProcessingToComplete: Story = { args: { state: "PROCESSING_TO_COMPLETE" } };
