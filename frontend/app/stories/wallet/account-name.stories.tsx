import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountNameForm, AccountSecurityIcon } from "../../../id/components/account-name-form";
import { WalletFrame } from "../../../id/components/wallet-frame";

const meta = {
  title: "ID/AccountName", component: AccountNameForm,
  args: { busy: false, onSubmit: () => {} },
  render: args => <WalletFrame embedded={false} requester="app.example.test" title="Name your account" icon={<AccountSecurityIcon />} busy={args.busy} onCancel={() => {}}><AccountNameForm {...args} /></WalletFrame>,
} satisfies Meta<typeof AccountNameForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Creating: Story = { args: { busy: true } };
