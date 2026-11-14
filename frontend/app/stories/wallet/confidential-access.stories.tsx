import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfidentialAccess } from '@/components/near/confidential-access';
import { setWalletState } from './api-mocks';
function ObservedUnlock({ state }: { state: string }) {
  useQuery({ queryKey: ['near', 'account', 'synthetic-unlock-story', 'balances'],
    enabled: state === 'ReadUnavailable', initialData: { synthetic: true }, staleTime: Infinity, retry: false,
    queryFn: async () => { if (state === 'ReadUnavailable') throw new Error('Balances could not be refreshed. Try again shortly.'); return { synthetic: true }; },
  });
  return <ConfidentialAccess panel={state !== 'Compact'} />;
}
function UnlockStory({ state }: { state: string }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><div className="mx-auto max-w-md p-6"><ObservedUnlock state={state} /></div></QueryClientProvider>;
}
const meta = {
  title: 'App/ConfidentialAccess', component: UnlockStory,
  args: { state: 'Idle' }, argTypes: { state: { control: false } },
  beforeEach: ({ args }) => { setWalletState(`Unlock${args.state}`); return () => setWalletState('Empty'); },
  play: async ({ args }) => {
    if (!['Idle', 'Compact'].includes(args.state)) fireEvent.click(within(document.body).getByRole('button', { name: 'Unlock balances' }));
  },
} satisfies Meta<typeof UnlockStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Idle: Story = {};
export const Compact: Story = { args: { state: 'Compact' } };
export const Waiting: Story = { args: { state: 'Waiting' } };
export const Cancelled: Story = { args: { state: 'Cancelled' } };
export const Unavailable: Story = { args: { state: 'Unavailable' } };
export const Complete: Story = { args: { state: 'Complete' } };

export const ReadUnavailable: Story = { args: { state: 'ReadUnavailable' } };
