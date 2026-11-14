import { fireEvent, within } from '@testing-library/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LegacyDepositForm } from '@/components/near/transfers';
import { TransferActivity } from '@/components/near/transfer-activity';
import { setTransferState, type State } from './api-mocks';
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle } from '@dya/ui/components/dialog-drawer';
function TransfersStory({ state }: { state: State }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retryDelay: 0, refetchOnWindowFocus: false } } }));
  const [action, setAction] = useState('');
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}><div className="p-4"><div className="max-w-5xl border"><TransferActivity accountId={state === 'SignedOut' ? null : 'demo'} openTransfers={() => setAction('Deposit')} openDeposit={() => setAction('Deposit instructions')} /></div></div><DialogDrawer open={!!action} onOpenChange={open => { if (!open) setAction(''); }}><DialogDrawerContent>{action === "Deposit" ? <LegacyDepositForm accountId="demo" onClose={() => setAction("")} /> : <><DialogDrawerHeader><DialogDrawerTitle>{action}</DialogDrawerTitle></DialogDrawerHeader><p>Demo navigation. No transfer is submitted.</p></>}</DialogDrawerContent></DialogDrawer></QueryClientProvider>;
}
const meta = { title: 'App/Transfers', component: TransfersStory, args: { state: 'Mixed' }, argTypes: { state: { control: false } }, beforeEach: context => { setTransferState(context.args.state); return () => setTransferState(null); }, render: args => <TransfersStory key={args.state} {...args} /> } satisfies Meta<typeof TransfersStory>;
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
export const Refunded: Story = { args: { state: 'Refunded' } };
export const Incomplete: Story = { args: { state: 'Incomplete' } };
export const Unconfirmed: Story = { args: { state: 'Unconfirmed' } };
export const StatusUnavailable: Story = { args: { state: 'StatusUnavailable' } };
export const Instructions: Story = { args: { state: 'Instructions' } };
export const ExpiredInstructions: Story = { args: { state: 'ExpiredInstructions' } };
export const DirectDeposits: Story = { args: { state: 'DirectDeposits' } };
export const DirectUnavailable: Story = { args: { state: 'DirectUnavailable' } };

export const Details: Story = { args: { state: "Mixed" }, play: async ({ canvasElement }: { canvasElement: HTMLElement }) => { fireEvent.click(await within(canvasElement).findByRole("row", { name: "View withdrawal transfer details, Processing" })); } };

export const InvalidTime: Story = { args: { state: 'InvalidTime' } };
