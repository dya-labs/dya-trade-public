import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { fireEvent, within } from '@testing-library/react';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntentsTrades } from '@/components/near/intents-trades';

type State = 'Trades' | 'TinyTrade' | 'Loading' | 'Empty' | 'Unavailable';
const now = 1792085160000;
const trades = [
  { time: now - 4_000, price: '105.954302898685604897', quantity: '0.55485606', side: 'sell', txHash: '3mWKowfgfFDPGfGZFyiz2DM8NnYpcFtWDkjbBT8GaYXZ' },
  { time: now - 88_000, price: '105.72188209797343207', quantity: '0.01133246', side: 'buy', txHash: '3Nkk79VvoDhyPBzGztynFmEQcSMagq7RLqe5YpsiESuX' },
  { time: now - 140_000, price: '105.8112', quantity: '12.5', side: 'buy', txHash: 'DQW1R8ai5peDbvBNdcV7Z2fCVVvfYL9wLZzhbzStchCn' },
];

/** Answers the component's data-API request for the state named in its market id; other requests pass through. */
function stubIntentsTrades() {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), window.location.href);
    if (url.pathname !== '/v1/intents/trades') return original(input, init);
    const state = url.searchParams.get('market')?.replace('intents:', '');
    if (state === 'Loading') return Promise.withResolvers<Response>().promise;
    if (state === 'Unavailable') return new Response('{}', { status: 503 });
    return Response.json({ market: url.searchParams.get('market'), trades: state === 'TinyTrade' ? [{ ...trades[0], price: '3.711', quantity: '0.000259' }] : state === 'Trades' ? trades : [] });
  };
  return () => { window.fetch = original; };
}

function IntentsTradesStory({ state }: { state: State }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retryDelay: 0, refetchOnWindowFocus: false } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>
    <div className="p-4"><div className="max-w-5xl border"><IntentsTrades marketId={`intents:${state}`} base={state === "TinyTrade" ? "NEAR" : "SOL"} baseAsset={state === "TinyTrade" ? DEFAULT_PAIR.base : undefined} /></div></div>
  </QueryClientProvider>;
}
const meta = {
  title: 'App/IntentsTrades', component: IntentsTradesStory,
  args: { state: 'Trades' }, argTypes: { state: { control: false } },
  beforeEach: stubIntentsTrades,
  render: args => <IntentsTradesStory key={args.state} {...args} />,
} satisfies Meta<typeof IntentsTradesStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Trades: Story = { args: { state: 'Trades' } };
export const Loading: Story = { args: { state: 'Loading' } };
export const Empty: Story = { args: { state: 'Empty' } };
export const Unavailable: Story = { args: { state: 'Unavailable' } };

export const SellDetails: Story = {
  play: async ({ canvasElement }) => {
    fireEvent.click(await within(canvasElement).findByRole('row', { name: 'View public sell SOL trade details' }));
  },
};
export const BuyDetails: Story = {
  play: async ({ canvasElement }) => {
    fireEvent.click((await within(canvasElement).findAllByRole('row', { name: 'View public buy SOL trade details' }))[0]);
  },
};
export const TinyTradeDetails: Story = {
  args: { state: 'TinyTrade' },
  play: async ({ canvasElement }) => {
    fireEvent.click(await within(canvasElement).findByRole('row', { name: 'View public sell NEAR trade details' }));
  },
};
