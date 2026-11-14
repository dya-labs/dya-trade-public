import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountSwitcherExploration, WalletBadgeExploration } from "./account-switcher/harness";
const meta = { title: "ID/Accounts/Design exploration", component: AccountSwitcherExploration, args: { populated: true }, parameters: { layout: "fullscreen" } } satisfies Meta<typeof AccountSwitcherExploration>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compare: Story = {};
export const BeforeTradingSetup: Story = { args: { populated: false } };

export const PanelRefinements: Story = { args: { round: "panel" } };

export const NoChevronBadge: Story = { render: ({ populated }) => <WalletBadgeExploration populated={populated} /> };
