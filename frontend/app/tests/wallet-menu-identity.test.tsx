vi.mock("@/lib/near/http/trading-client", () => ({ getMarketTrades: async () => ({ trades: state.withTrade ? [{ id: "eth-buy", createdAt: Date.now(), state: "settled", review: { side: "buy", pair: { base: { ...DEFAULT_PAIR.base, symbol: "ETH", blockchain: "eth" }, quote: DEFAULT_PAIR.quote }, estimatedOutput: "0.000008" } }] : [] }) }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletMenu } from "@/components/near/wallet-menu";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

const state = vi.hoisted(() => ({ withTrade: false, holdings: [] as {assetId:string;symbol:string;decimals:number;raw:string;amount:string}[], kind: "deposit", assetId: undefined as string | undefined, network: "Base", createdAt: 1 }));
const actual = { ...DEFAULT_PAIR.quote, assetId: "synthetic:actual-usdc", blockchain: "base" };
const unrelated = { ...actual, assetId: "synthetic:unrelated-usdc", coingeckoId: "unrelated" };
vi.mock("@/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: { assets: state.holdings }, error: null }) }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [unrelated, actual, { ...DEFAULT_PAIR.base, assetId: "eth", symbol: "ETH", blockchain: "eth", decimals: 18 }] }, error: null }) }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: async () => ({ assets: {} }) }));
vi.mock("@/lib/near/http/funding-conversions-client", () => ({ fundingHistory: async () => ({ operations: [] }) }));
vi.mock("@/lib/near/http/transfers-client", () => ({
  getDeposits: async () => ({ deposits: state.kind === "deposit" ? [{ id: "deposit", createdAt: state.createdAt, status: "SUCCESS", creditedAmount: "2", quote: { asset: "USDC", sourceAssetId: state.assetId, sourceChain: state.network } }] : [] }),
  getWithdrawals: async () => ({ withdrawals: state.kind === "withdrawal" ? [{ id: "withdrawal", createdAt: state.createdAt, state: "settled", review: { originAsset: state.assetId, asset: "USDC", amount: "2", destinationChain: state.network } }] : [] }),
  getBridgeDeposits: async () => ({ deposits: [] }),
}));
vi.mock("@/components/near/asset-mark", () => ({ AssetMark: ({ asset }: { asset: { assetId: string } }) => <span data-testid="activity-asset" data-asset={asset.assetId} /> }));
vi.mock("@/components/near/network-mark", () => ({ NetworkMark: ({ network }: { network: string }) => <span data-testid="activity-network" data-network={network} /> }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); state.createdAt = 1; state.withTrade = false; state.holdings = []; });
async function showActivity() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><WalletMenu account={{ id: "synthetic-account", kind: "passkey" }} onDeposit={() => {}} onWithdraw={() => {}} onFunding={() => {}} onSignOut={() => {}} onActivity={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  await waitFor(() => expect(screen.getByRole("tabpanel", { name: "Activity" }).querySelector('[skullet-loading]')).toBeNull());
  await screen.findByText(state.kind === "deposit" ? "Deposited" : "Withdrawn");
}
it.each([
  { withTrade: false, holdings: [] as {assetId:string;symbol:string;decimals:number;raw:string;amount:string}[], kind: "deposit", assetId: "synthetic:actual-usdc", expected: "synthetic:actual-usdc" },
  { withTrade: false, holdings: [] as {assetId:string;symbol:string;decimals:number;raw:string;amount:string}[], kind: "deposit", assetId: undefined, expected: undefined },
  { kind: "withdrawal", assetId: "synthetic:actual-usdc", expected: "synthetic:actual-usdc" },
  { kind: "withdrawal", assetId: "synthetic:missing-usdc", expected: undefined },
])("uses only recorded identity for $kind activity with asset $assetId", async ({ kind, assetId, expected }) => {
  state.kind = kind; state.assetId = assetId; state.network = "Base";
  await showActivity();
  if (expected) expect(screen.getByTestId("activity-asset")).toHaveAttribute("data-asset", expected);
  else {
    expect(screen.queryByTestId("activity-asset")).toBeNull();
    expect(screen.getByTestId("activity-network")).toHaveAttribute("data-network", "base");
  }
});
it("keeps an unknown wallet activity network generic without guessing a token", async () => {
  state.kind = "deposit"; state.assetId = undefined; state.network = "Unknown";
  await showActivity();
  expect(screen.queryByTestId("activity-asset")).toBeNull();
  expect(screen.queryByTestId("activity-network")).toBeNull();
});
it("keeps wallet activity readable when its timestamp exceeds the Date range", async () => {
  state.kind = "withdrawal"; state.assetId = "synthetic:actual-usdc"; state.network = "Base"; state.createdAt = 9e15;
  await showActivity();
  expect(screen.getByText("Withdrawn")).toBeInTheDocument();
  expect(screen.getByTitle("Time unavailable")).toHaveTextContent("-");
  expect(screen.getByText("2.00 USDC")).toBeInTheDocument();
});

it.each(["Personal", "A".repeat(64), undefined])("shows the private account identity in the wallet trigger: %s", name => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><WalletMenu account={{ id: "synthetic-account", kind: "passkey", name }} onDeposit={() => {}} onWithdraw={() => {}} onFunding={() => {}} onSignOut={() => {}} onActivity={() => {}} /></QueryClientProvider>);
  const trigger = screen.getByRole("button", { name: "Open wallet" });
  expect(trigger).toHaveTextContent(name ?? "Wallet");
  expect(trigger.querySelector('[data-slot="avatar"]')).not.toBeNull();
  expect(trigger.querySelector(".truncate")).not.toBeNull();
});

it("defaults to Assets, exposes ETH holdings, and switches to trades with configured ID links", async () => {
  state.holdings = [{ assetId: "eth", symbol: "ETH", decimals: 18, raw: "8000000000000", amount: "0.000008" }];
  state.withTrade = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><WalletMenu idOrigin="http://localhost:3101" account={{ id: "synthetic-account", kind: "passkey" }} onDeposit={() => {}} onWithdraw={() => {}} onFunding={() => {}} onSignOut={() => {}} onActivity={() => {}} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
  expect(screen.getByRole("tab", { name: "Assets" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("table", { name: "Asset balances" })).toHaveTextContent("ETH");
  expect(screen.getByRole("link", { name: "View all assets" })).toHaveAttribute("href", "http://localhost:3101/assets");
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  expect(await screen.findByText("Bought ETH")).toBeVisible();
  expect(screen.getByRole("link", { name: "View all activity" })).toHaveAttribute("href", "http://localhost:3101/activity");
  expect(screen.getByRole("link", { name: "View all activity" })).toHaveAttribute("target", "_blank");
});

it("shows account settings inside the wallet and returns with the back button", async () => {
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
 const onSignOut=vi.fn();
 render(<QueryClientProvider client={client}><WalletMenu account={{id:"settings-account",kind:"passkey"}} idOrigin="http://localhost:3101" onDeposit={vi.fn()} onWithdraw={vi.fn()} onFunding={vi.fn()} onSignOut={onSignOut} onActivity={vi.fn()} /></QueryClientProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Open wallet"}));
 fireEvent.click(await screen.findByRole("button",{name:"Account settings"}));
 expect(screen.getByRole("heading",{name:"Settings"})).toBeVisible();
 expect(screen.queryByText("Total balance")).toBeNull();
 const manage=screen.getByRole("link",{name:"Manage account in Dya ID"});
 expect(manage).toHaveAttribute("href","http://localhost:3101");expect(manage).toHaveAttribute("target","_blank");
 fireEvent.click(screen.getByRole("button",{name:"Back to wallet"}));
 expect(screen.getByText("Total balance")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Account settings"}));
 fireEvent.click(screen.getByRole("button",{name:"Sign out"}));
 expect(onSignOut).toHaveBeenCalledOnce();
});
