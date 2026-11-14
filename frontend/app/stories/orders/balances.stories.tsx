import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { within, waitFor } from '@testing-library/react';
import { ActivityPanel, type ActivityTab } from '@/components/near/activity-panel';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { balanceQueryKey } from '@dya/wallet-ui/hooks/use-live-balances';
import { setWalletState } from '../wallet/api-mocks';
import { accountId, setOrdersState } from './api-mocks';
import { setTradesState } from '../trades/api-mocks';

type State = 'Loading' | 'Empty' | 'Unavailable' | 'DelayedWithCachedBalances';
function BalancesStory({ state }: { state: State }) {
  const [client] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchInterval: false } } });
    if (state === 'DelayedWithCachedBalances') {
      client.setQueryData(balanceQueryKey(accountId), { assets: [{ ...DEFAULT_PAIR.quote, raw: '1250500000', amount: '1250.50' }] }, { updatedAt: Date.now() - 60000 });
    }
    return client;
  });
  const [tab, setTab] = useState<ActivityTab>('balances');
  return <QueryClientProvider client={client}><div className="p-4"><ActivityPanel accountId={accountId} pair={DEFAULT_PAIR} value={tab} onChange={setTab} className="dia-panel h-56 max-w-6xl overflow-hidden border" openTransfers={() => {}} openDeposit={() => {}} /></div></QueryClientProvider>;
}
const meta = {
  title: 'App/Balances', component: BalancesStory,
  args: { state: 'Empty' },
  beforeEach: ({ args }) => {
    setOrdersState('Empty'); setTradesState('Empty');
    setWalletState(args.state === 'Unavailable' ? 'BalancesRecoverable' : args.state === 'DelayedWithCachedBalances' ? 'BalancesUnavailable' : args.state);
  },
  render: args => <BalancesStory key={args.state} {...args} />,
} satisfies Meta<typeof BalancesStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = { args: { state: 'Loading' } };
export const Empty: Story = { args: { state: 'Empty' }, play: async ({ canvasElement }) => { await within(canvasElement).findByText('No assets yet'); } };
export const Unavailable: Story = { args: { state: 'Unavailable' }, play: async ({ canvasElement }) => { const canvas=within(canvasElement); await canvas.findByText('Couldn’t load balances'); await canvas.findByRole('button', { name: 'Retry' }); } };
export const DelayedWithCachedBalances: Story = { args: { state: 'DelayedWithCachedBalances' }, play: async ({ canvasElement }) => { const canvas=within(canvasElement); await canvas.findByText('Updates delayed'); await waitFor(() => { if (!canvas.getByRole('table', { name: 'Balances' }).textContent?.includes('1,250.50')) throw new Error('Cached balances missing'); }); } };
