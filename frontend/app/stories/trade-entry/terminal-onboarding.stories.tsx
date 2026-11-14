import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NearTerminal } from "@/components/near/terminal";
import { setWalletState } from "../wallet/api-mocks";
import { dashboardScenario } from "../wallet/dashboard-api-mocks";
import { setOrdersState } from "../orders/api-mocks";
import { setTradesState } from "../trades/api-mocks";
import { setFundingScenario } from "../funding/api-mocks";
import { setWithdrawalState } from "../withdrawal/api-mocks";

function TerminalPreview() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}><NearTerminal /></QueryClientProvider>;
}
const meta = {
  title: "App/TerminalOnboarding", component: TerminalPreview,
  parameters: { layout: "fullscreen" },
  beforeEach: async () => {
    dashboardScenario(null); setWalletState("FundingOnly"); setOrdersState("Empty"); setTradesState("Empty"); setFundingScenario("Selection"); setWithdrawalState("Configure");
    localStorage.removeItem("dya:funding-trading-guide:v1:storybook-account");
  },
} satisfies Meta<typeof TerminalPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FundingAvailableTradingEmpty: Story = {};
