import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, within } from "@testing-library/react";
import { useIsMobile } from "@dya/ui/hooks/use-mobile";
import { PanelLeftIcon } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@dya/ui/components/sidebar";
import { MarketHeader } from "@/components/near/market-header";
import { Balances as BalancesTable } from "@/components/near/balances";
import { Portfolio } from "@/components/near/portfolio";
import { Orders } from "@/components/near/orders";
import { MarketTrades } from "@/components/near/market-trades";
import { TransferActivity } from "@/components/near/transfer-activity";
import { WalletMenu } from "@/components/near/wallet-menu";
import { OrderTicketForm } from "@/components/near/ticket";
import { AssetSelector } from "@/components/near/asset-selector";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { setWalletState } from "../wallet/api-mocks";
import { setOrdersState } from "../orders/api-mocks";
import { setTradesState } from "../trades/api-mocks";
import { setTransferState } from "../transfers/api-mocks";

type Component = "Balances" | "Wallet" | "Orders" | "Trades" | "Transfers" | "Portfolio" | "MarketHeader" | "AssetSelector" | "Sidebar" | "OrderTicket";
function configure(loading: boolean) {
  setWalletState(loading ? "Loading" : "TradingBalance");
  setOrdersState(loading ? "Loading" : "Open");
  setTradesState(loading ? "Loading" : "Completed");
  setTransferState(loading ? "Loading" : "Completed");
}
function ComponentPreview({ component }: { component: Component }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [loading, setLoading] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const mobile = useIsMobile(640);
  useEffect(() => () => client.clear(), [client]);
  function toggle() {
    configure(!loading);
    setLoading(!loading);
    void client.resetQueries();
  }
  return <QueryClientProvider client={client}><div className="space-y-6 p-4">
    <div className="flex items-center gap-3"><Button variant="outline" onClick={toggle}>{loading ? "Show data" : "Replay loading"}</Button><p className="text-xs text-muted-foreground">Mock data · real components</p></div>
    {component === "Wallet" && <WalletMenu account={{ id: "storybook", kind: "passkey", name: "Personal" }} onDeposit={() => {}} onWithdraw={() => {}} onFunding={() => {}} onSignOut={() => {}} onActivity={() => {}} />}
    {component === "Orders" && <Orders accountId="storybook" />}
    {component === "Trades" && <MarketTrades accountId="storybook" />}
    {component === "Transfers" && <TransferActivity accountId="storybook" openTransfers={() => {}} openDeposit={() => {}} />}
    {component === "Balances" && <BalancesTable accountId="storybook" />}
    {component === "Portfolio" && <Portfolio accountId="storybook" loading={false} busy={false} connect={() => {}} deposit={() => {}} withdraw={() => {}} activity={null} />}
    {component === "MarketHeader" && <MarketHeader pair={DEFAULT_PAIR} assets={[DEFAULT_PAIR.base, DEFAULT_PAIR.quote]} awaitingAsset={loading} statsLoading={loading} capLoading={loading} headerPrice={4.25} headerChange={3} headerChangeAmount={0.12} headerVolume={1000000} headerCap={1000000000} mobile={mobile} marketStatsOpen={statsOpen} setMarketStatsOpen={setStatsOpen} retryCatalog={() => {}} onSelect={() => {}} />}
    {component === "AssetSelector" && <AssetSelector label="base asset" asset={DEFAULT_PAIR.base} assets={loading ? [] : [DEFAULT_PAIR.base, DEFAULT_PAIR.quote]} excludedId={DEFAULT_PAIR.quote.assetId} catalogRetrying={loading} retryCatalog={() => {}} onSelect={() => {}} />}
    {component === "Sidebar" && <SidebarProvider className="min-h-0"><Sidebar collapsible="none"><SidebarContent><SidebarMenu>{["Markets", "Portfolio", "Transfers"].map(label => <SidebarMenuItem key={label}><SidebarMenuButton><PanelLeftIcon />{label}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent></Sidebar></SidebarProvider>}
    {component === "OrderTicket" && <div className="max-w-sm"><OrderTicketForm account={{ id: "storybook", kind: "passkey" }} signIn={() => {}} marketPrice={4.25} restoring={loading} /></div>}
  </div></QueryClientProvider>;
}
const meta = {
  title: "App/Loading previews", component: ComponentPreview,
  args: { component: "MarketHeader" }, argTypes: { component: { control: false } },
  beforeEach: () => { configure(true); return () => setTransferState(null); },
  render: args => <ComponentPreview key={args.component} {...args} />,
} satisfies Meta<typeof ComponentPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Market: Story = {};
export const Wallet: Story = { args: { component: "Wallet" }, play: async ({ canvasElement }) => { fireEvent.click(await within(canvasElement).findByRole("button", { name: "Open wallet" })); } };
export const OrderTable: Story = { args: { component: "Orders" } };
export const TradeTable: Story = { args: { component: "Trades" } };
export const Transfers: Story = { args: { component: "Transfers" } };
export const Balances: Story = { args: { component: "Balances" } };
export const Holdings: Story = { args: { component: "Portfolio" } };
export const TokenSelector: Story = { args: { component: "AssetSelector" }, play: async ({ canvasElement }) => { fireEvent.click(await within(canvasElement).findByRole("button", { name: /Select market/ })); } };
export const Navigation: Story = { args: { component: "Sidebar" } };
export const TradingAccess: Story = { args: { component: "OrderTicket" } };
