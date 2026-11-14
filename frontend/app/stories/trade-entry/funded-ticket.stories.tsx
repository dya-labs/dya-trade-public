import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderTicket } from '@/components/near/funded-ticket';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { setFundedNetworkFixture } from './funded-network-fixture';
import { setTicketState } from './api-mocks';
import { setWalletState } from '../wallet/api-mocks';

function FundedTicketStory() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  useEffect(() => () => { client.clear(); setFundedNetworkFixture(false); }, [client]);
  return <QueryClientProvider client={client}><div className="p-4"><div className="w-full max-w-sm border"><OrderTicket pair={DEFAULT_PAIR} account={{ id: 'storybook', kind: 'passkey' }} signIn={() => {}} marketPrice={4} /></div></div></QueryClientProvider>;
}
const meta = {
  title: 'App/FundedTicket', component: FundedTicketStory,
  beforeEach: () => { setFundedNetworkFixture(true); setTicketState('MarketBuy'); setWalletState('TicketBalance'); },
} satisfies Meta<typeof FundedTicketStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MultipleNetworks: Story = {};
