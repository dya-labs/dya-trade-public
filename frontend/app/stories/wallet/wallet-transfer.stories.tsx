import type { Meta, StoryObj } from '@storybook/react-vite';
import { WalletTransfer } from '../../../id/components/wallet-transfer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { assets, setScenario } from '../deposit/api-mocks';
import { setWalletState } from './api-mocks';
import { setTransferState } from '../transfers/api-mocks';
import { setWithdrawalState } from '../withdrawal/api-mocks';
function StoryWalletProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    value.setQueryData(["near", "catalog"], {assets});
    value.setQueryData(["near", "account", "storybook-wallet", "balances", "confidential", "all"], {accountId: "storybook-wallet", blockHeight: 0, checkedAt: 1, assets: [{assetId: assets[0].assetId, symbol: "USDC", decimals: 6, raw: "1250500000", amount: "1250.50"}]});
    return value;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const meta = {
  title: 'ID/WalletTransfer', component: WalletTransfer,
  decorators: [(Story) => <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6"><StoryWalletProvider><Story /></StoryWalletProvider></div>],
  args: { accountId: 'storybook-wallet', onBack: () => {}, onUpdated: () => {}, onSignOut: () => {} },
  beforeEach: () => { setWalletState('WithActivity'); setTransferState(null); setScenario('PENDING_DEPOSIT'); setWithdrawalState('Configure'); },
} satisfies Meta<typeof WalletTransfer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Receive: Story = { args: { direction: 'receive' } };
export const Send: Story = { args: { direction: 'send' } };
