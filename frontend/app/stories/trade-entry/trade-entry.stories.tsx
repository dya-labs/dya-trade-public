import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderTicketForm } from '@/components/near/ticket';
import { getAllBalances, setWalletState } from '../wallet/api-mocks';
import { Button } from '@dya/ui/components/button';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { setWithdrawalState } from '../withdrawal/api-mocks';
import { setTicketState } from './api-mocks';
function TradeEntryStory({ state }: { state: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [balanceChanged, setBalanceChanged] = useState(false);
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}><div className="p-4"><div className="w-full max-w-sm border"><OrderTicketForm account={state === 'SignedOut' ? null : {id:'storybook',kind:'passkey'}} signIn={() => {}} marketPrice={4} lastPrice={4} /></div>{state === 'BalanceChanged' && <Button className="mt-4" variant="outline" disabled={balanceChanged} onClick={() => {
    setTicketState('Quoting');setWalletState('TicketBalanceChanged');setBalanceChanged(true);
    client.setQueryData<Awaited<ReturnType<typeof getAllBalances>>>(['near','account','storybook','balances','confidential','all'], old => old ? { ...old, assets: old.assets.map(asset => asset.assetId === DEFAULT_PAIR.quote.assetId ? { ...asset, amount: '10', raw: '10000000' } : asset) } : old);
  }}>Simulate balance change</Button>}</div></QueryClientProvider>;
}
const meta = { title: 'App/TradeEntry', component: TradeEntryStory, args: {state:'MarketBuy'}, argTypes: {state:{control:false}}, beforeEach: context => {
  const state = context.args.state;
  setTicketState(state); setWalletState(state === 'LoadingBalanceReveal' ? 'LoadingBalanceReveal' : state === 'LoadingBalance' ? 'Loading' : state === 'BalancesUnavailable' ? 'BalancesUnavailable' : state === 'ConfirmAccess' ? 'ConfirmAccess' : 'TicketBalance'); setWithdrawalState(['PasskeyConfirmation','LimitPasskeyConfirmation'].includes(state) ? 'PasskeyConfirmation' : ['PasskeyCancelled','LimitPasskeyCancelled'].includes(state) ? 'PasskeyCancelled' : 'Configure');
}, render: args => <TradeEntryStory key={args.state} {...args} />, play: async ({canvasElement, args}: {canvasElement:HTMLElement;args:{state:string}}) => {
  const canvas = within(canvasElement);
  if (['SignedOut','LoadingBalance','LoadingBalanceReveal','BalancesUnavailable','ConfirmAccess'].includes(args.state)) return;
  if (args.state.startsWith('Limit')) {
    fireEvent.click(canvas.getByRole('tab',{name:'Limit'})); fireEvent.change(canvas.getByLabelText('Price (USDC)'),{target:{value:'4'}});
    const sell = args.state === 'LimitSellReview';
    if (sell) fireEvent.click(canvas.getByRole('tab',{name:'Sell'}));
    fireEvent.change(canvas.getByLabelText('Size'),{target:{value:'25'}});
    if (args.state === 'LimitBuy') return;
    fireEvent.click(canvas.getByRole('button',{name:'Review'}));

  }
  if (args.state === 'MarketSell') fireEvent.click(canvas.getByRole('tab',{name:'Sell'}));
  fireEvent.change(canvas.getByLabelText('Size'),{target:{value:args.state === 'InsufficientBalance' ? '500' : '25'}});
  if (['Review','Confirmation','PasskeyConfirmation','Submitted','QuoteExpired','PasskeyCancelled','SubmissionUnconfirmed','PreparationRecovery'].includes(args.state)) {
    const button = await canvas.findByRole('button',{name:'Review'});
    await waitFor(() => { if ((button as HTMLButtonElement).disabled) throw new Error('Waiting for quote'); });fireEvent.click(button);
  }
} } satisfies Meta<typeof TradeEntryStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MarketBuy: Story = {args:{state:'MarketBuy'}};
export const BalanceChanged: Story = {args:{state:'BalanceChanged'}};
export const MarketSell: Story = {args:{state:'MarketSell'}};
export const LimitBuy: Story = {args:{state:'LimitBuy'}};
export const SignedOut: Story = {args:{state:'SignedOut'}};
export const LoadingBalance: Story = {args:{state:'LoadingBalance'}};
export const BalancesUnavailable: Story = {args:{state:'BalancesUnavailable'}};
export const ConfirmAccess: Story = {args:{state:'ConfirmAccess'}};
export const InsufficientBalance: Story = {args:{state:'InsufficientBalance'}};
export const Quoting: Story = {args:{state:'Quoting'}};
export const QuoteUnavailable: Story = {args:{state:'QuoteUnavailable'}};
export const Review: Story = {args:{state:'Review'}};
export const Confirmation: Story = {args:{state:'Confirmation'}};
export const PasskeyConfirmation: Story = {args:{state:'PasskeyConfirmation'}};
export const Submitted: Story = {args:{state:'Submitted'}};
export const QuoteExpired: Story = {args:{state:'QuoteExpired'}};
export const PasskeyCancelled: Story = {args:{state:'PasskeyCancelled'}};
export const SubmissionUnconfirmed: Story = {args:{state:'SubmissionUnconfirmed'}};

export const PreparationRecovery: Story = {args:{state:'PreparationRecovery'}};
export const LimitReview: Story = {args:{state:'LimitReview'}};
export const LimitSellReview: Story = {args:{state:'LimitSellReview'}};
export const LimitConfirmation: Story = {args:{state:'LimitConfirmation'}};
export const LimitExpired: Story = {args:{state:'LimitExpired'}};
export const LimitPreparing: Story = {args:{state:'LimitPreparing'}};
export const LimitPreparationRecovery: Story = {args:{state:'LimitPreparationRecovery'}};
export const LimitPasskeyConfirmation: Story = {args:{state:'LimitPasskeyConfirmation'}};
export const LimitPasskeyCancelled: Story = {args:{state:'LimitPasskeyCancelled'}};
export const LimitSubmitting: Story = {args:{state:'LimitSubmitting'}};
export const LimitSubmissionUnconfirmed: Story = {args:{state:'LimitSubmissionUnconfirmed'}};
export const LimitSubmitted: Story = {args:{state:'LimitSubmitted'}};
export const LimitCloseRecovery: Story = {args:{state:'LimitCloseRecovery'}};

function BalanceRevealStory() {
  const [attempt, setAttempt] = useState(0);
  return <>
    <div className="px-4 pt-4"><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Replay balance loading</Button><p className="mt-2 text-xs text-muted-foreground">Mock balance resolves after two seconds. Switch Buy/Sell to review each asset.</p></div>
    <TradeEntryStory key={attempt} state="LoadingBalanceReveal" />
  </>;
}
export const LoadingBalanceReveal: Story = {
  args: { state: 'LoadingBalanceReveal' },
  render: () => <BalanceRevealStory />,
};
