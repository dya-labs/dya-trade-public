import { DEFAULT_PAIR } from '@dya/wallet-contracts/src/domain/catalog';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { WalletFlow } from '../../../id/components/wallet-flow';
import { useState, type ComponentProps } from 'react';
const meta = {
  title: 'ID/WalletFlow', component: WalletFlow,
  args: { id: 'storybook', kind: 'connect', clientOrigin: 'http://localhost:3100', callback: 'http://localhost:3100/api/wallet/callback', status: 'pending', review: undefined, options: undefined, session: { account: null, passkeyOrigin: 'https://id.example.test' } },
} satisfies Meta<typeof WalletFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Connect: Story = {};
export const WithdrawalReview: Story = { args: { kind: 'approval', review: { title: 'Review withdrawal', details: { asset: 'USDC', amount: '100', estimatedReceive: '99.80', minimumReceived: '98.80', network: 'Base', recipient: '0x1111111111111111111111111111111111111111' } } } };
export const AlreadyStarted: Story = { args: { status: 'running' } };
export const CancelledPasskey: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement.ownerDocument.body); await userEvent.click(await canvas.findByRole('button', { name: 'Sign in' })); await canvas.findByText('Passkey confirmation was cancelled. Try again when you’re ready.'); } };

export const CreateWallet: Story = { args: { connectionKind: "register" } };
export const SwitchAccountConfirmation: Story = { args: { session: { account: { id: "synthetic-private-account", kind: "passkey", name: "Personal" }, passkeyOrigin: "https://id.example.test" } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement.ownerDocument.body); await userEvent.click(await canvas.findByRole("button", { name: "Switch account" })); await canvas.findByRole("heading", { name: "Switch account?" }); } };
export const UnlockBalances: Story = { args: { kind: "approval", review: { title: "Unlock confidential balances", details: {} } } };
export const TradeReview: Story = { args: { kind: "approval", review: { title: "Review market trade", details: { side: "buy", sourceAsset: { ...DEFAULT_PAIR.quote, price: "1" }, destinationAsset: { ...DEFAULT_PAIR.base, price: "5" }, slippageBps: 100, inputAsset: "USDC", inputAmount: "100", outputAsset: "NEAR", estimatedOutput: "20", minimumOutput: "19.8", expires: new Date(Date.now() + 120000).toISOString() } } } };

export const Expired: Story = { args: { kind: "approval", status: "expired", review: { title: "Wallet request expired" } } };
function ExpiringApproval(args: ComponentProps<typeof WalletFlow>) {
  const [expiresAt] = useState(() => Date.now() + 5000);
  return <WalletFlow {...args} expiresAt={expiresAt} />;
}
export const ApprovalDeadline: Story = { args: { kind: 'approval', review: { title: 'Review market trade', details: { inputAsset: 'USDC', inputAmount: '100', outputAsset: 'NEAR', estimatedOutput: '20', minimumOutput: '19.8' } } }, render: args => <ExpiringApproval {...args} /> };
export const FundingConversionReview: Story = { args: { kind: 'approval', review: { title: 'Review funding conversion', details: { asset: 'NEAR', sourceAsset: DEFAULT_PAIR.base, destinationAsset: DEFAULT_PAIR.quote, amount: '25', outputAsset: 'USDC', estimatedOutput: '99.123456', minimumOutput: '98', expires: new Date(Date.now() + 120000).toISOString() } } } };
export const LimitFundingReview: Story = { args: { kind: 'approval', review: { title: 'Fund limit order', details: { side: 'sell', asset: 'SOL', quantity: '1', price: '4', quoteAsset: 'USDC', fundingAsset: 'SOL', fundingAmount: '1', fees: 'Included in the provider funding amount' } } } };
export const BackupAuthorization: Story = { args: { kind: 'approval', review: { title: 'Confirm backup passkey setup', details: {} } } };

export const NamedAccount: Story = { args: { session: { account: { id: "synthetic-private-account", kind: "passkey", name: "Personal", intentsIdentity: { accountId: "0x1111111111111111111111111111111111111111", publicKey: "synthetic" } }, passkeyOrigin: "https://id.example.test" } } };
export const Welcome: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement.ownerDocument.body); await userEvent.click(await canvas.findByRole("button", { name: "Create account" })); await canvas.findByRole("heading", { name: "Welcome to DYA", level: 1 }); } };

export const ExpiredTradeReview: Story = { args: { ...TradeReview.args, status: "expired" } };

export const LimitReview: Story = { args: { kind: "approval", review: { title: "Fund limit order", details: { side: "buy", baseAsset: { ...DEFAULT_PAIR.base, price: "5" }, sourceAsset: { ...DEFAULT_PAIR.quote, price: "1" }, quoteToken: { ...DEFAULT_PAIR.quote, price: "1" }, quantity: "20", price: "4.9", quoteAsset: "USDC", fundingAsset: "USDC", fundingAmount: "98", fees: "Included in funding", orderExpires: new Date(Date.now() + 86400000).toISOString(), expires: Date.now() + 120000 } } } };
export const ExpiredLimitReview: Story = { args: { ...LimitReview.args, status: "expired" } };
