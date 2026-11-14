import type { Meta, StoryObj } from '@storybook/react-vite';
import { WalletProgress } from '../../../id/components/wallet-progress';
const meta = { title: 'ID/WalletProgress', component: WalletProgress, decorators: [(Story) => <div className="flex min-h-dvh items-center justify-center p-6"><Story /></div>] } satisfies Meta<typeof WalletProgress>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LoadingAccount: Story = { args: { title: 'Loading account…' } };
export const SigningIn: Story = { args: { title: 'Signing in…', description: 'Check your device for a confirmation prompt.' } };
export const CreatingAccount: Story = { args: { title: 'Creating account…', description: 'Check your device for a confirmation prompt.' } };
