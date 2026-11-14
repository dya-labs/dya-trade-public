import type { Meta, StoryObj } from '@storybook/react-vite';
import { WalletPageHeader } from '../../../id/components/wallet-page-header';
const meta = {
  title: 'ID/PageHeader', component: WalletPageHeader,
  decorators: [(Story) => <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6"><Story /></div>],
  args: { avatarSeed: "0x441d7f484f33499baf2c5b8caec27e3042ed306d", onSignOut: () => {} },
} satisfies Meta<typeof WalletPageHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Home: Story = {};
export const Receive: Story = { args: { title: 'Receive', onBack: () => {} } };
export const Send: Story = { args: { title: 'Send', onBack: () => {} } };
export const Busy: Story = { args: { title: 'Send', onBack: () => {}, disabled: true } };

export const AnotherAccount: Story = { args: { avatarSeed: "0x1234567890abcdef1234567890abcdef12345678" } };
export const Fallback: Story = { args: { avatarSeed: null } };
