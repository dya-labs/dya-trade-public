import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletMenu } from '@/components/near/wallet-menu';
import { setWalletState } from './api-mocks';
import { LegacyDepositForm } from '@/components/near/transfers';
import { DialogDrawer, DialogDrawerContent } from '@dya/ui/components/dialog-drawer';
import { setScenario } from '../deposit/api-mocks';

function WalletStory({ state }: { state: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [action, setAction] = useState('');
  const [depositOpen, setDepositOpen] = useState(false);
  return <QueryClientProvider client={client}><div className="flex min-h-screen flex-col items-end gap-4 p-6">
    <WalletMenu account={{ id: 'storybook', name: 'Personal', kind: 'passkey' }}
      onDeposit={() => setDepositOpen(true)} onWithdraw={() => setAction('Withdraw')}
      onFunding={() => setAction('Transfer')} onSignOut={() => setAction('Sign out')}
      onActivity={() => setAction('Transfer activity')} />
    {action && <p role="status">{action} selected (Storybook demo)</p>}
    <span className="sr-only">{state}</span>
  </div><DialogDrawer open={depositOpen} onOpenChange={setDepositOpen}><DialogDrawerContent className="max-h-[85dvh] overflow-y-auto"><LegacyDepositForm accountId="storybook" onClose={() => setDepositOpen(false)} onDetails={() => setDepositOpen(false)} /></DialogDrawerContent></DialogDrawer></QueryClientProvider>;
}
const meta = {
  title: 'App/Wallet', component: WalletStory,
  args: { state: 'Empty' }, argTypes: { state: { control: false } },
  beforeEach: context => { setWalletState(context.args.state); setScenario("PENDING_DEPOSIT"); },
  render: args => <WalletStory key={args.state} {...args} />,
  play: async ({ canvasElement }) => {
    fireEvent.click(await within(canvasElement).findByRole('button', { name: 'Open wallet' }));
  },
} satisfies Meta<typeof WalletStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Loading: Story = { args: { state: 'Loading' } };
export const TradingBalance: Story = { args: { state: 'TradingBalance' } };
export const FundingBalance: Story = { args: { state: 'FundingBalance' } };
export const WithActivity: Story = { args: { state: 'WithActivity' } };
export const InvalidActivityTime: Story = { args: { state: 'InvalidActivityTime' } };
export const ConfirmAccess: Story = { args: { state: 'ConfirmAccess' } };
export const BalancesUnavailable: Story = { args: { state: 'BalancesUnavailable' } };
export const PartialValuation: Story = { args: { state: 'PartialValuation' } };
export const PricesUnavailable: Story = { args: { state: 'PricesUnavailable' } };
export const ActivityUnavailable: Story = { args: { state: 'ActivityUnavailable' } };

export const FundingOnly: Story = { args: { state: "FundingOnly" } };
