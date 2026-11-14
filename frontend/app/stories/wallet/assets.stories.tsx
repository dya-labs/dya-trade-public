import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletAssets } from '@dya/wallet-ui/components/wallet-assets';
import { groupedHoldings, groupedCatalog } from '@/tests/fixtures/wallet-assets';
function AssetGroups({ includeUnknown = false }: { includeUnknown?: boolean }) {
  const [client] = useState(() => new QueryClient());
  const holdings = includeUnknown ? [...groupedHoldings, { ...groupedHoldings[0], assetId: 'synthetic:unrelated-usdc', amount: '9', raw: '9000000' }] : groupedHoldings;
  return <QueryClientProvider client={client}><div className="mx-auto max-w-2xl space-y-4 p-4"><p className="text-sm text-muted-foreground">Synthetic holdings for interaction testing</p><WalletAssets holdings={holdings} catalog={groupedCatalog} /></div></QueryClientProvider>;
}
const meta = { title: 'Shared/WalletAssets', component: AssetGroups } satisfies Meta<typeof AssetGroups>;
export default meta;
export const Grouped: StoryObj<typeof meta> = {};
export const UnrelatedTicker: StoryObj<typeof meta> = { args: { includeUnknown: true } };
