import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { RecipientAddress } from '@dya/wallet-ui/components/near/recipient-address';
import { Button } from '@dya/ui/components/button';
function CopyScenario({ address }: { address: string }) {
  const [error, setError] = useState('');
  return <div className="w-full p-4"><RecipientAddress address={address} onCopyError={setError} />{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}</div>;
}
const meta = { title: 'Shared/RecipientAddress', component: CopyScenario, args: { address: '0x1234567890123456789012345678901234567890' } } satisfies Meta<typeof CopyScenario>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Copy: Story = {};
function RestrictedCopyScenario() {
  const [blocked, setBlocked] = useState(true);
  return <div className="space-y-3 p-4"><Button variant="outline" onClick={() => setBlocked(false)} disabled={!blocked}>{blocked ? 'Reload with clipboard allowed' : 'Clipboard allowed in test frame'}</Button><iframe key={blocked ? 'restricted' : 'allowed'} title="Recipient clipboard permission fixture" className="h-64 w-full border-0" allow={blocked ? "clipboard-write 'none'" : 'clipboard-write *'} src="iframe.html?id=shared-recipientaddress--copy&viewMode=story&globals=theme:dark" /></div>;
}
export const Restricted: Story = { render: () => <RestrictedCopyScenario /> };
