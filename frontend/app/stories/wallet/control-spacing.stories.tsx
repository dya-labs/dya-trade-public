import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LabeledSelectTrigger } from "@dya/wallet-ui/components/labeled-select-trigger";
import { RecipientAddress } from "@dya/wallet-ui/components/near/recipient-address";
import { NetworkMark } from "@dya/wallet-ui/components/near/network-mark";
import { toast } from "@dya/ui/lib/toast";

function ControlSpacing() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
    <div className="mx-auto w-full max-w-sm space-y-6 p-3">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Long network name</h2>
        <LabeledSelectTrigger label="Network" value="Arbitrum One with a deliberately long network name" icon={<NetworkMark network="arbitrum" />} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Long recipient address</h2>
        <RecipientAddress address={"a".repeat(128)} onCopyError={message => { if (message) toast.error(message); }} />
      </section>
    </div>
    </QueryClientProvider>
  );
}
const meta = { title: "Shared/ControlSpacing", component: ControlSpacing } satisfies Meta<typeof ControlSpacing>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LongContent: Story = {};
