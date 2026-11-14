import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { WalletRecovery } from '../../../id/components/wallet-recovery';
const meta = {
  title: 'ID/Recovery', component: WalletRecovery,
  decorators: [(Story) => <div className="mx-auto max-w-2xl p-6"><Story /></div>],
  args: { mode: 'enroll', recoveryId: 'synthetic-recovery-id', onCancel: () => {}, onComplete: () => {} },
} satisfies Meta<typeof WalletRecovery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Enrollment: Story = {};
export const Recover: Story = { args: { mode: 'recover', recoveryId: '' } };
export const Review: Story = { args: { mode: 'recover' }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Connect recovery wallet' }));
  await userEvent.click(await canvas.findByRole('button', { name: 'Create replacement passkey' }));
  await canvas.findByRole('button', { name: 'Sign and recover' });
} };
export const Completed: Story = { args: { mode: 'recover' }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Connect recovery wallet' }));
  await userEvent.click(await canvas.findByRole('button', { name: 'Create replacement passkey' }));
  await userEvent.click(await canvas.findByRole('button', { name: 'Sign and recover' }));
  await canvas.findByText('Account access restored');
} };
export const CompletionUnavailable: Story = {
  ...Completed,
  args: { mode: 'recover', onComplete: async () => { throw new Error('Unable to refresh your dashboard. Try Done again.'); } },
  play: async context => {
    await Completed.play?.(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }));
    await canvas.findByText('Unable to refresh your dashboard. Try Done again.');
  },
};
