import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from '@testing-library/react';
import { BackupPasskey } from '@/components/near/backup-passkey';
import { setBackupStory } from './api-mocks';
import { setWithdrawalState } from '../withdrawal/api-mocks';
function BackupStory({ state }: { state: string }) {
  const [enrollmentUntil] = useState(() => Date.now() + 60000);
  const account = { id: 'synthetic-backup-story', kind: 'passkey' as const,
    ...(state === 'Resume' ? { backupEnrollmentUntil: enrollmentUntil } : {}),
    ...(['Saved', 'Tested'].includes(state) ? { backup: { status: 'pending_onchain' as const, ...(state === 'Tested' ? { testedAt: 1 } : {}) } } : {}),
  };
  return <div className="mx-auto max-w-md p-6"><BackupPasskey account={account} refresh={async () => { if (state === 'RefreshUnavailable') throw new Error('Account details could not be refreshed. Try again shortly.'); }} /></div>;
}
const meta = {
  title: 'App/BackupPasskey', component: BackupStory,
  args: { state: 'Setup' }, argTypes: { state: { control: false } },
  beforeEach: ({ args }) => {
    setBackupStory(true);
    setWithdrawalState(args.state === 'Waiting' ? 'PasskeyConfirmation' : args.state === 'Cancelled' ? 'PasskeyCancelled' : 'Configure');
    return () => { setBackupStory(false); setWithdrawalState('Configure'); };
  },
  play: async ({ args }) => {
    if (['Waiting', 'Cancelled', 'RefreshUnavailable'].includes(args.state)) fireEvent.click(within(document.body).getByRole('button', { name: 'Set up backup passkey' }));
  },
} satisfies Meta<typeof BackupStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Setup: Story = {};
export const Resume: Story = { args: { state: 'Resume' } };
export const Waiting: Story = { args: { state: 'Waiting' } };
export const Cancelled: Story = { args: { state: 'Cancelled' } };
export const Saved: Story = { args: { state: 'Saved' } };
export const Tested: Story = { args: { state: 'Tested' } };

export const RefreshUnavailable: Story = { args: { state: 'RefreshUnavailable' } };
