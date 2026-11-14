import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '@dya/ui/components/button';
import { WalletQueryProvider } from '@dya/wallet-ui/components/wallet-query-provider';
import { TradingAccountName } from '../../../id/components/trading-account-name';
import { TradingActivation } from '../../../id/components/trading-activation';
import { createScenario, sampleQuote, type Journey } from './trading-setup-mocks';

type Stage = 'entry' | 'name' | 'activation' | 'opened' | 'discarded';

function SetupScenario({ journey, snapshot }: { journey: Journey; snapshot?: 'expired' | 'claimable' }) {
  const [stage, setStage] = useState<Stage>(snapshot ? 'activation' : 'entry');
  const [client] = useState(() => createScenario(
    snapshot === 'claimable' ? { ...sampleQuote, phase: 'refund', outcome: 'active', refundPhase: 'owed', refundOwedYoctoNear: '1000000000000000000000' }
      : snapshot === 'expired' ? sampleQuote : null,
    journey,
  ));
  const [accountId] = useState(() => crypto.randomUUID());

  return <WalletQueryProvider><div className="mx-auto w-full max-w-2xl space-y-4 px-4">
    {stage === 'entry' && <>
      <p className="text-sm text-muted-foreground">{journey === 'resume' ? 'An unpaid setup is already saved.' : 'Passkey approvals and payments are simulated in this story.'}</p>
      <Button onClick={() => setStage('name')}>Create account</Button>
    </>}
    {stage === 'name' && <TradingAccountName
      resume={async () => ({ account: journey === 'resume' ? { id: accountId, name: 'Trading' } : null })}
      createAccount={async (_requestId, name, asset = 'USDC') => {
        await client.saveSetupPaymentAsset(asset);
        return { account: { id: accountId, name } };
      }}
      onContinue={() => setStage('activation')}
    />}
    {stage === 'activation' && <>
      {journey === 'change-token' && !snapshot && <p className="text-sm text-muted-foreground">Choose NEAR in Setup to review a quote in NEAR.</p>}
      <div onClick={event => {
        if (!(event.target instanceof Element) || !event.target.closest('a[href="/"]')) return;
        event.preventDefault();
        setStage('opened');
      }}>
        <TradingActivation renderHeader={back=><Button variant="outline" onClick={back}>Back</Button>} onBack={()=>setStage("entry")} client={client} accountId={accountId} asset="USDC" ready onActivated={() => {}} onDiscarded={() => setStage('discarded')} />
      </div>
    </>}
    {stage === 'opened' && <p role="status">Trading account opened.</p>}
    {stage === 'discarded' && <p role="status">Unpaid setup discarded.</p>}
  </div></WalletQueryProvider>;
}

const meta = { title: 'ID/Trading account/Current setup', component: SetupScenario } satisfies Meta<typeof SetupScenario>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CreateTradingAccount: Story = { args: { journey: 'create' } };
export const ChooseNearForSetup: Story = { args: { journey: 'change-token' } };
export const ResumeUnfinishedSetup: Story = { args: { journey: 'resume' } };
export const ResolveUncertainPayment: Story = { args: { journey: 'uncertain' } };
export const RecoverSetupRefund: Story = { args: { journey: 'refund' } };
export const ExpiredQuote: Story = { args: { journey: 'create', snapshot: 'expired' } };
export const RefundClaimable: Story = { args: { journey: 'create', snapshot: 'claimable' } };
