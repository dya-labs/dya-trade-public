import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { RelativeTime } from '@dya/wallet-ui/components/relative-time';
const meta = { title: 'Shared/RelativeTime', component: RelativeTime, args: { timestamp: 0 } } satisfies Meta<typeof RelativeTime>;
export default meta;
function TimestampExamples() {
  const [timestamp] = useState(() => Date.now() - 60_000);
  return <div className="space-y-4 p-4 text-sm">
    <p>Recent transfer: <RelativeTime timestamp={timestamp} /></p>
    <p>Transfer details: <RelativeTime timestamp={timestamp} format="full" /></p>
    <p>Unavailable transfer time: <RelativeTime timestamp={9e15} /></p>
  </div>;
}
export const Examples: StoryObj<typeof meta> = { render: () => <TimestampExamples /> };
