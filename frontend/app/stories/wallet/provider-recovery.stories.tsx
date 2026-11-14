import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { ProviderWalletRecovery } from '../../../id/components/provider-wallet-recovery';
import { setProviderRecoveryPhase } from './recovery-api-mocks';
const meta = {
  title: 'ID/ProviderRecovery', component: ProviderWalletRecovery,
  decorators: [(Story) => <div className="mx-auto max-w-2xl p-6"><Story /></div>],
  args: { mode: 'recover', onCancel: () => {}, onComplete: () => {} },
} satisfies Meta<typeof ProviderWalletRecovery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Start: Story = {};
export const Pending: Story = { beforeEach: () => setProviderRecoveryPhase('recover_add_pending'), play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await userEvent.click(canvas.getByRole('button', { name: 'Connect recovery wallet' })); await canvas.findByText('Key change awaiting confirmation. Check status before starting another request.');
} };
export const Revoke: Story = { beforeEach: () => setProviderRecoveryPhase('recover_remove'), play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await userEvent.click(canvas.getByRole('button', { name: 'Connect recovery wallet' })); await canvas.findByRole('button', { name: 'Revoke previous keys' });
} };
export const Complete: Story = { beforeEach: () => setProviderRecoveryPhase('recover_finish'), play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await userEvent.click(canvas.getByRole('button', { name: 'Connect recovery wallet' })); await userEvent.click(await canvas.findByRole('button', { name: 'Finish with new passkey' })); await canvas.findByText('Wallet recovered');
} };

export const Discovery: Story = { beforeEach: () => setProviderRecoveryPhase("recover_discover") };
export const Accounts: Story = { beforeEach: () => setProviderRecoveryPhase("recover_select"), play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Connect recovery wallet" })); await canvas.findByText("Choose an account to recover."); } };
