import type { Meta, StoryObj } from '@storybook/react-vite';
import { RecoveryId } from '../../../id/components/wallet-recovery-id';
const meta = { title: 'ID/RecoveryID', component: RecoveryId, args: { value: 'synthetic-recovery-id-do-not-use' }, render: args => <div className="p-4"><RecoveryId {...args} /></div> } satisfies Meta<typeof RecoveryId>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Copy: Story = {};
export const Restricted: Story = { render: () => <iframe title="Clipboard-restricted recovery ID" className="h-72 w-full border-0" allow="clipboard-write 'none'" src="iframe.html?id=id-recoveryid--copy&viewMode=story&globals=theme:dark" /> };
