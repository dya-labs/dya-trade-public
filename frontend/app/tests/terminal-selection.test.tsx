import { withTokenPolicy } from "./fixtures/token-policy";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { CatalogAsset, SelectedPair } from "@/lib/near/domain/catalog";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { NearTerminal } from "@/components/near/terminal";
const state = vi.hoisted(() => ({
  ticker: undefined as { lastPrice: string; openPrice?: string; quoteVolume: string; changePercent: number } | undefined,
  catalog: undefined as { assets: CatalogAsset[]; tokens?: import("../../../packages/wallet-contracts/src/domain/token-registry").TokenRecord[] } | undefined,
  catalogError: false,
  session: { data: { account: null } as { account: null } | undefined, failureCount: 0, error: null as Error | null, isError: false, isPending: false, isFetching: false },
  retrySession: vi.fn(),
  intentsMarketId: undefined as string | undefined,
  intentsTrades: [] as { time: number; price: string }[],
  market: null as { id: string; assetId: string; venue: string; base: string; quote: string; sourceLabel: string; firstOpenTime: number } | null,
  plan: null as unknown,
  drawEntryLevels: vi.fn(),
  degraded: null as { cause: string; since: number } | null,
}));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: state.catalog, isError: state.catalogError }) }));
vi.mock("@/components/near/use-terminal-data", () => ({ useTerminalData: () => ({ session: { ...state.session, refetch: state.retrySession }, refreshSession: vi.fn(), clearAccount: vi.fn() }) }));
vi.mock("@/lib/market-data/hooks", () => ({ useIntentsTrades: () => ({ data: state.intentsTrades }), useAssetMarket: () => ({ market: state.market, intentsMarket: state.intentsMarketId ? { id: state.intentsMarketId } : null }), useMarketTicker: () => ({ ticker: state.ticker }), useDataDegraded: () => state.degraded }));
vi.mock("@/components/near/use-chart-analysis", () => ({ useChartAnalysis: () => ({ entryPlan: state.plan, analyzing: false, analysisMessage: "", drawEntryLevels: state.drawEntryLevels }) }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: async () => ({ updatedAt: Date.now(), assets: {} }) }));
vi.mock("@/components/near/chart", () => ({ NearChart: ({ asset, entryPlan }: { asset: CatalogAsset; entryPlan?: { levels: unknown[] } | null }) => <div data-testid="chart" data-levels={entryPlan?.levels.length ?? 0}>{asset.assetId}</div> }));
vi.mock("@/components/near/funded-ticket", () => ({ OrderTicket: ({ pair, unavailable, suspended, lastPrice }: { pair: SelectedPair; unavailable: boolean; suspended?: boolean; lastPrice?: number | null }) => <div data-testid="ticket" data-unavailable={unavailable} data-suspended={!!suspended} data-last-price={lastPrice}>{pair.base.assetId}|{pair.quote.assetId}</div> }));
vi.mock("@/components/near/asset-selector", () => ({ AssetSelector: ({ assets, onSelect }: { assets: CatalogAsset[]; onSelect: (asset: CatalogAsset) => void }) => <button onClick={() => onSelect(assets.find(asset => asset.symbol === "BTC")!)}>Choose BTC</button> }));
vi.mock("@/components/near/wallet-menu", () => ({ WalletMenu: () => null }));
vi.mock("@/components/near/funding-dialog", () => ({ FundingDialog: () => null }));
vi.mock("@/components/near/transfers", () => ({ LegacyDepositForm: () => null, WithdrawalForm: () => null }));
vi.mock("@/components/near/backup-passkey", () => ({ BackupPasskey: () => null }));
vi.mock("@/components/near/intents-trades", () => ({ IntentsTrades: () => null }));
vi.mock("@/components/near/confidential-access", () => ({ ConfidentialAccess: () => null }));
vi.mock("@/components/near/data-status", () => ({ DataStatus: () => null, feedState: () => "ready" }));
const btc: CatalogAsset = { ...DEFAULT_PAIR.base, assetId: "nep141:nbtc.bridge.near", symbol: "BTC", blockchain: "near", coingeckoId: "bitcoin" };
const key = "nervana:selected-base-asset";
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><NearTerminal /></QueryClientProvider>); }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); state.ticker = undefined; state.catalog = undefined; state.catalogError = false; state.session = { data: { account: null }, failureCount: 0, error: null, isError: false, isPending: false, isFetching: false }; state.retrySession.mockReset(); state.intentsMarketId = undefined; state.intentsTrades = []; state.market = null; state.plan = null; state.drawEntryLevels.mockReset(); });
it("shows skeletons instead of the default token until the catalog restores the saved one", async () => {
  localStorage.setItem(key, JSON.stringify(btc.assetId));
  state.intentsMarketId = "intents:NEAR_USD";
  const view = mount();
  expect(screen.getByLabelText("Loading chart")).toBeInTheDocument();
  expect(screen.getByLabelText("Loading market")).toBeInTheDocument();
  expect(document.title).toBe("Dya.trade");
  expect(screen.getByLabelText("Loading order ticket")).toBeInTheDocument();
  expect(screen.queryByTestId("chart")).toBeNull();
  expect(screen.queryByTestId("ticket")).toBeNull();
  expect(screen.queryByRole("tab", { name: "Intents trades" })).toBeNull();
  state.catalog = withTokenPolicy({ assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote, btc] });
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(screen.getByTestId("chart")).toHaveTextContent(btc.assetId);
  expect(screen.getByTestId("ticket")).toHaveTextContent(`${btc.assetId}|${DEFAULT_PAIR.quote.assetId}`);
  expect(screen.queryByLabelText("Loading chart")).toBeNull();
});
it("falls back to the default token when the catalog fails, and restores the saved one once it loads", () => {
  localStorage.setItem(key, JSON.stringify(btc.assetId));
  state.catalogError = true;
  const view = mount();
  expect(screen.getByTestId("chart")).toHaveTextContent(DEFAULT_PAIR.base.assetId);
  state.catalogError = false;
  state.catalog = withTokenPolicy({ assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote, btc] });
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(screen.getByTestId("chart")).toHaveTextContent(btc.assetId);
});
it.each([
  ["the data API reports degradation", { cause: "near-intents", since: 1 }, false, true],
  ["the Terminal catalog request fails", null, true, true],
  ["everything is healthy", null, false, false],
] as const)("shows the service-degraded banner and pauses the ticket only when %s, keeping the chart", (_, degraded, catalogError, shown) => {
  state.degraded = degraded;
  state.catalogError = catalogError;
  try {
    mount();
    expect(!!screen.queryByText("Service degraded")).toBe(shown);
    if (shown) expect(screen.getByText("Service degraded").closest("[data-slot=alert]")).toHaveTextContent("NEAR chain infrastructure (NEAR Intents 1Click) is having issues.");
    expect(screen.getByTestId("chart")).toHaveTextContent(DEFAULT_PAIR.base.assetId);
    expect(screen.getByTestId("ticket")).toHaveAttribute("data-suspended", String(shown));
  } finally { state.degraded = null; }
});
it("shows the default token right away when it is the saved or only choice", () => {
  localStorage.setItem(key, JSON.stringify(DEFAULT_PAIR.base.assetId));
  mount();
  expect(screen.getByTestId("chart")).toHaveTextContent(DEFAULT_PAIR.base.assetId);
  cleanup();
  localStorage.clear();
  mount();
  expect(screen.getByTestId("chart")).toHaveTextContent(DEFAULT_PAIR.base.assetId);
});
it.each(["removed-token", DEFAULT_PAIR.quote.assetId])("discards invalid saved base identity %s", async saved => {
  state.catalog = withTokenPolicy({ assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote, btc] });
  localStorage.setItem(key, JSON.stringify(saved));
  mount();
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  expect(screen.getByTestId("chart")).toHaveTextContent(DEFAULT_PAIR.base.assetId);
});
it("keeps manual selection usable when persistence is denied", async () => {
  state.catalog = withTokenPolicy({ assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote, btc] });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Denied"); });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Choose BTC" }));
  await waitFor(() => expect(screen.getByTestId("chart")).toHaveTextContent(btc.assetId));
  expect(screen.getByTestId("ticket")).toHaveTextContent(`${btc.assetId}|${DEFAULT_PAIR.quote.assetId}`);
});
it("persists manual selection and does not overwrite it with delayed restoration", async () => {
  state.catalog = withTokenPolicy({ assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote, btc] });
  localStorage.setItem(key, JSON.stringify(DEFAULT_PAIR.base.assetId));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Choose BTC" }));
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(localStorage.getItem(key)).toBe(JSON.stringify(btc.assetId));
  expect(screen.getByTestId("chart")).toHaveTextContent(btc.assetId);
  expect(screen.getByTestId("ticket")).toHaveTextContent(`${btc.assetId}|${DEFAULT_PAIR.quote.assetId}`);
});

it("guards the trading ticket until the initial session request completes", () => {
  state.session.data = undefined;
  state.session.isPending = true;
  const view = mount();
  expect(screen.getByTestId("ticket")).toHaveAttribute("data-unavailable", "true");
  expect(screen.getByTestId("ticket").closest("aside")).toHaveAttribute("inert");
  expect(screen.getByRole("button", { name: "Connect", hidden: true })).toBeDisabled();
  state.session.data = { account: null };
  state.session.isPending = false;
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(screen.getByTestId("ticket")).toHaveAttribute("data-unavailable", "false");
  expect(screen.getByTestId("ticket").closest("aside")).not.toHaveAttribute("inert");
});
it("shows recoverable account failure and retry progress without enabling the ticket early", () => {
  state.session.error = new Error("offline"); state.session.isError = true; state.session.failureCount = 3;
  const view = mount();
  expect(screen.getByText("Account connection unavailable")).toBeInTheDocument();
  expect(screen.getByTestId("ticket")).toHaveAttribute("data-unavailable", "true");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retrySession).toHaveBeenCalledOnce();
  state.session.isFetching = true;
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(screen.getByRole("button", { name: "Reconnecting…" })).toBeDisabled();
  expect(screen.getByTestId("ticket")).toHaveAttribute("data-unavailable", "true");
  state.session.error = null; state.session.isError = false; state.session.failureCount = 0; state.session.isFetching = false;
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(screen.queryByText("Account connection unavailable")).not.toBeInTheDocument();
  expect(screen.getByTestId("ticket")).toHaveAttribute("data-unavailable", "false");
});

it("navigates signed-out activity panels without fetching private history or claiming zero activity", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("Unexpected network"));
  vi.stubGlobal("fetch", fetch);
  mount();
  expect(screen.getByText("Connect your wallet to view balances.")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Transfers" }));
  expect(await screen.findByText("Connect a passkey to view transfers.")).toBeVisible();
  expect(screen.queryByText("No transfers yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Trade history" }));
  expect(await screen.findByText("Sign in to view trade history.")).toBeVisible();
  expect(screen.queryByText("No trades yet.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Open orders" }));
  expect(await screen.findByText("Connect a passkey to view your orders.")).toBeVisible();
  expect(screen.queryByText("No orders yet.")).not.toBeInTheDocument();
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
});
it("falls back to Balances if the current asset loses its public Intents market", () => {
  state.intentsMarketId = "intents:WNEAR_USD";
  const view = mount();
  fireEvent.click(screen.getByRole("tab", { name: "Market trades" }));
  expect(screen.getByRole("tab", { name: "Market trades" })).toHaveAttribute("aria-selected", "true");
  state.intentsMarketId = undefined; state.intentsTrades = [];
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(screen.queryByRole("tab", { name: "Market trades" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Balances" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("Connect your wallet to view balances.")).toBeVisible();
});

const reference = (venue: string, quote: string) => ({ id: `${venue}:NEAR`, assetId: DEFAULT_PAIR.base.assetId, venue, base: "NEAR", quote, sourceLabel: venue, firstOpenTime: 0 });
const plan = (source: string) => ({ levels: [{}, {}, {}], profile: "WAIT", market: { assetId: DEFAULT_PAIR.base.assetId, source, quote: "USDT", symbol: "NEAR" } });
it("runs Jev manually from Insights and gives the chart only the reference market's plan", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  state.market = reference("gate", "USDT");
  state.plan = plan("Gate");
  const view = mount();
  expect(screen.queryByText(/3 watch levels/)).toBeNull();
  expect(screen.getByTestId("chart")).toHaveAttribute("data-levels", "3");
  expect(screen.queryByRole("button", { name: "Refresh levels" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Insights/ }));
  await screen.findByRole("button", { name: "Refresh levels" });
  expect(screen.queryByText(/watch levels.*uncalibrated/)).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Refresh levels" }));
  expect(state.drawEntryLevels).toHaveBeenCalledWith();
  expect(screen.queryByRole("switch", { name: /Auto/ })).toBeNull();
  // A saved plan for another reference market is neither drawn nor counted.
  state.plan = plan("Binance");
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(screen.queryByText(/levels · uncalibrated/)).toBeNull();
  expect(screen.getByTestId("chart")).toHaveAttribute("data-levels", "0");
});
it("disables Jev for a reference market it can't analyze", async () => {
  state.market = reference("rhea", "USD");
  mount();
  fireEvent.click(screen.getByRole("button", { name: /^Insights/ }));
  expect(await screen.findByRole("button", { name: "Refresh levels" })).toBeDisabled();
});
it.each([[true, 2], [false, 0]] as const)("offers resizable chart, activity and ticket panels only on desktop (desktop=%s)", (desktop, separators) => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: desktop && query === "(min-width: 1024px)", addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mount();
  expect(screen.queryAllByRole("separator", { name: /^Resize / })).toHaveLength(separators);
  // The same chart, activity tabs and ticket render in either layout.
  expect(screen.getByTestId("chart")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Open orders" })).toBeInTheDocument();
  expect(screen.getByTestId("ticket")).toBeInTheDocument();
});

it("retains the public Intents Last price wiring with main’s market model", async () => {
  vi.useFakeTimers();
  state.intentsMarketId = "near-intents";
  state.intentsTrades = [{ time: Date.now(), price: "4" }];
  state.catalog = withTokenPolicy({ assets: [DEFAULT_PAIR.base, { ...DEFAULT_PAIR.quote, price: "0.5", priceUpdatedAt: new Date().toISOString() }] });
  mount();
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByTestId("ticket")).toHaveAttribute("data-last-price", "8");
});

it("hides chart levels without removing the plan and remembers the visibility preference", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  state.market = reference("gate", "USDT"); state.plan = plan("Gate");
  const view = mount();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  fireEvent.click(screen.getByRole("button", { name: /^Insights/ }));
  fireEvent.click(await screen.findByRole("switch", { name: "Show chart levels" }));
  expect(screen.getByTestId("chart")).toHaveAttribute("data-levels", "0");
  expect(state.plan).not.toBeNull();
  expect(state.drawEntryLevels).not.toHaveBeenCalled();
  expect(localStorage.getItem("nervana:chart-levels-visible")).toBe("false");
  view.unmount(); mount();
  await waitFor(() => expect(screen.getByTestId("chart")).toHaveAttribute("data-levels", "0"));
  fireEvent.click(screen.getByRole("button", { name: /^Insights/ }));
  fireEvent.click(await screen.findByRole("switch", { name: "Show chart levels" }));
  expect(screen.getByTestId("chart")).toHaveAttribute("data-levels", "3");
});


it("updates the browser title when selecting a market and resets on unmount", () => {
  state.catalog = withTokenPolicy({ assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote, btc] });
  const view = mount();
  expect(document.title).toBe(`${displaySymbol(DEFAULT_PAIR.base)} · Dya.trade`);
  fireEvent.click(screen.getByRole("button", { name: "Choose BTC" }));
  expect(document.title).toBe("BTC · Dya.trade");
  view.unmount();
  expect(document.title).toBe("Dya.trade");
});

it("includes the header price, updates it live, and omits unavailable prices", () => {
  state.market = reference("gate", "USDT");
  state.ticker = { lastPrice: "82350.25", quoteVolume: "100000", changePercent: 1 };
  const view = mount();
  expect(document.title).toBe(`82,350.3 · ${displaySymbol(DEFAULT_PAIR.base)} · Dya.trade`);
  state.ticker.lastPrice = "82400";
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(document.title).toBe(`82,400 · ${displaySymbol(DEFAULT_PAIR.base)} · Dya.trade`);
  state.ticker = undefined;
  view.rerender(<QueryClientProvider client={new QueryClient()}><NearTerminal /></QueryClientProvider>);
  expect(document.title).toBe(`${displaySymbol(DEFAULT_PAIR.base)} · Dya.trade`);
});

it.each([
  ["5.35", "5", 7, "+0.35", "+7.00%"],
  ["4.65", "5", -7, "-0.35", "-7.00%"],
  ["5", "5", 0, "0", "0.00%"],
])("shows absolute and percentage 24h change for %s", (lastPrice, openPrice, changePercent, absolute, percent) => {
  state.market = reference("gate", "USDT");
  state.ticker = { lastPrice, openPrice, quoteVolume: "1000", changePercent };
  mount();
  const change = screen.getByText("24h change").parentElement!;
  expect(change.textContent?.replace(/\s/g, "")).toBe(`24hchange${absolute}/${percent}`);
});

it("opens portfolio in the shared shell without rendering the trading chart or ticket", () => {
  render(<QueryClientProvider client={new QueryClient()}><NearTerminal view="portfolio" /></QueryClientProvider>);
  expect(screen.getByRole("heading", { name: "Portfolio", level: 1 })).toBeVisible();
  expect(screen.getByRole("link", { name: "PORTFOLIO" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "TRADE" })).not.toHaveAttribute("aria-current");
  expect(screen.queryByTestId("chart")).toBeNull();
  expect(screen.queryByTestId("ticket")).toBeNull();
  expect(document.title).toBe("Portfolio · Dya.trade");
});

it("keeps the ticket mounted and token selection shared between mobile Markets and Trade", () => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  state.catalog = withTokenPolicy({assets:[DEFAULT_PAIR.base,DEFAULT_PAIR.quote,btc]});
  mount();
  const ticket = screen.getByTestId('ticket');
  expect(ticket.closest('section[aria-label="Trade view"]')).toHaveClass('hidden');
  const trade = screen.getByRole('link',{name:/^Trade$/});
  trade.addEventListener('click',event=>event.preventDefault(),{once:true});
  fireEvent.click(trade);
  expect(screen.getByTestId('ticket')).toBe(ticket);
  expect(ticket.closest('section[aria-label="Trade view"]')).not.toHaveClass('hidden');
  fireEvent.click(screen.getByRole('button',{name:'Choose BTC'}));
  const selectedTicket = screen.getByTestId('ticket');
  expect(selectedTicket).toHaveTextContent(btc.assetId);
  const markets = screen.getByRole('link',{name:'Markets'});
  markets.addEventListener('click',event=>event.preventDefault(),{once:true});
  fireEvent.click(markets);
  expect(screen.getByTestId('ticket')).toBe(selectedTicket);
  expect(screen.getByTestId('chart')).toHaveTextContent(btc.assetId);
});

it("remembers the selected activity tab across remounts and rejects unknown saved tabs", () => {
 const first = mount();
 expect(screen.getByRole("tab", { name: "Balances" })).toHaveAttribute("aria-selected", "true");
 fireEvent.click(screen.getByRole("tab", { name: "Order history" }));
 expect(localStorage.getItem("dya:activity-tab")).toBe(JSON.stringify("order-history"));
 first.unmount();
 const second = mount();
 expect(screen.getByRole("tab", { name: "Order history" })).toHaveAttribute("aria-selected", "true");
 second.unmount();
 localStorage.setItem("dya:activity-tab", JSON.stringify("unknown"));
 mount();
 expect(screen.getByRole("tab", { name: "Balances" })).toHaveAttribute("aria-selected", "true");
});
