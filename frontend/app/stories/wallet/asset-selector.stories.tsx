import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AssetSelector } from '@/components/near/asset-selector';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';

const searchAssets = [DEFAULT_PAIR.base, { assetId: 'synthetic-btc', symbol: 'BTC', decimals: 8, blockchain: 'bitcoin' }, { assetId: 'synthetic-shib', symbol: 'SHIB', decimals: 18, blockchain: 'ethereum' }, DEFAULT_PAIR.quote];
function SelectorScenario({ state }: { state: 'Loading' | 'Unavailable' | 'Cached' | 'Search' }) {
  const [selected, setSelected] = useState(DEFAULT_PAIR.base);
  const [client] = useState(() => {
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    query.setQueryData(['near', 'token-markets'], { updatedAt: Date.now(), assets: {} });
    return query;
  });
  return <QueryClientProvider client={client}><div className="p-6"><AssetSelector label="base asset" asset={selected} assets={state === 'Search' ? searchAssets : state === 'Cached' ? [DEFAULT_PAIR.base] : []} excludedId={DEFAULT_PAIR.quote.assetId} catalogUnavailable={state !== 'Loading' && state !== 'Search'} catalogRetrying={state === 'Loading'} retryCatalog={() => {}} onSelect={setSelected} /></div></QueryClientProvider>;
}
const meta = {
  title: 'App/AssetSelector', component: SelectorScenario,
  args: { state: 'Loading' }, argTypes: { state: { control: false } },
  render: args => <SelectorScenario key={args.state} {...args} />,
  play: async () => { fireEvent.click(within(document.body).getByRole('button', { name: /Select market/ })); },
} satisfies Meta<typeof SelectorScenario>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const Unavailable: Story = { args: { state: 'Unavailable' } };
export const Cached: Story = { args: { state: 'Cached' } };
export const Search: Story = { args: { state: 'Search' } };
