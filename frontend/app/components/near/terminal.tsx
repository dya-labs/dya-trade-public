"use client";
import { FeedbackDialog } from "./feedback-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@dya/ui/components/tooltip";
import { XIcon, TelegramIcon } from "@dya/ui/components/social-icons";
import { shortRelease } from "@dya/ui/lib/release";
import { InsightsIcon } from "@dya/ui/icons";
import { NavigationIcon } from "@dya/ui/components/navigation-icon";
import { AnimatedNavLink } from "@dya/ui/components/animated-nav-link";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@dya/ui/components/dropdown-menu";
import { MenuToggleIcon } from "@dya/ui/components/menu-toggle-icon";
import { BrandLogo } from "@dya/ui/components/brand-logo";
import { DYA_BRAND, DYA_URLS, TOAST_MESSAGES } from "@dya/config";
import { formatNumber } from "@dya/ui/lib/format-number";
import { z } from "zod";
import { ExternalLink, LoaderCircle, Check, BookOpen, BookOpenFilled } from "@dya/ui/icons";
import { createLocalPreference } from "@/lib/local-storage";
import { sizingReferencePrice } from "@/lib/near/domain/sizing-price";
import { intentsLastPrice } from "@/lib/market-data/intents-last-price";
import { useIntentsTrades, useAssetMarket, useMarketTicker, useDataDegraded } from "@/lib/market-data/hooks";
import { ServiceDegradedBanner, serviceDegraded } from "./service-degraded-banner";
import { MarketHeader } from "./market-header";
import { DyaLoader } from "@dya/ui/components/dya-loader";
import { OrderTicketLoading } from "./ticket";
import { logout } from "@/lib/near/http/account-client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@dya/ui/components/resizable";
import { useTerminalData } from "./use-terminal-data";
import { signIn, passkeyError } from "@/lib/near/client/sign-in";

import type { TrackedDepositQuote } from "@/lib/near/http/schemas/transfers";
import { TOKEN_MARKETS_FRESH_MS } from "@/lib/near/domain/token-icons";
import { APP_NAVIGATION } from "@/lib/navigation";
import { approveTradingWithdrawal, estimateTradingWithdrawal, prepareTradingWithdrawalApproval, readTradingWithdrawal } from "@dya/wallet-ui/lib/near/http/trading-wallet-client";
import type { WithdrawalSource } from "@dya/wallet-ui/components/near/withdrawal-form";
import { useTradingWallet } from "@dya/wallet-ui/hooks/use-trading-wallet";
import { useStoredSelection } from "@dya/wallet-ui/hooks/use-stored-selection";
import { WalletMenu } from "./wallet-menu";
import { FundingDialog } from "./funding-dialog";
import { LegacyDepositForm, WithdrawalForm } from "./transfers";
import { ActivityPanel, type ActivityTab } from "./activity-panel";
import { useOrders } from "./use-activity";
import { readTradingOpenOrders } from "@dya/wallet-ui/lib/near/http/trading-wallet-client";
import { chartOrderLines, chartLinesForPair } from "./chart-orders";
import { NearChart } from "./chart";
import type { OutlayerReview } from "./use-order-ticket";
import { D } from "@/lib/near/domain/decimal";
import { JevChat, type Draft } from "./jev-chat";
import { JevRefresh, JevSettings } from "./jev-controls";
import { useChartAnalysis } from "./use-chart-analysis";
import { jevMarket } from "@/lib/near/http/schemas/market";
import { InsightsMenu } from "./insights-menu";
import { OrderTicket } from "./funded-ticket";
import { Button, buttonVariants } from "@dya/ui/components/button";
import { toast } from "@dya/ui/lib/toast";
import { DialogDrawer, DialogDrawerContent } from "@dya/ui/components/dialog-drawer";
import { DEFAULT_PAIR, makePair, quantityRaw, type SelectedPair } from "@/lib/near/domain/catalog";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { getTokenMarkets } from "@/lib/near/http/catalog-client";
import { useQuery } from "@tanstack/react-query";
import { selectableTradingAssets } from "../../../../packages/wallet-contracts/src/domain/token-registry";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { DataStatus, feedState, type FeedHealth } from "./data-status";
import { Portfolio } from "./portfolio";
import { SignOutDialog } from "@dya/wallet-ui/components/sign-out-dialog";

const chartLevelsPreference = createLocalPreference("nervana:chart-levels-visible", z.boolean());
const selectedAssetPreference = createLocalPreference("nervana:selected-base-asset", z.string().min(1).max(512));
const activityTabPreference = createLocalPreference("dya:activity-tab", z.enum(["balances", "orders", "order-history", "my-trades", "transfers", "intents-trades"]));
type TradePanel = ActivityTab;
// Desktop arranges the chart, activity and ticket in resizable panels; smaller screens stack them.
// The footer carries Vela's attribution wherever it shows (sm and up); below that the chart keeps
// Vela's own mark (src/globals.css), since its license requires one on screen.
const VELA_URL = "https://velacharts.dev/?utm_source=vela&utm_medium=attribution";
const DESKTOP = "(min-width: 1024px)";
const subscribeDesktop = (change: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const isDesktop = () => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP).matches;
// Panel sizes are remembered per browser; unavailable storage only loses the saved sizes.
const layoutStorage = {
  getItem(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } },
};
// Matches the 4px gutters between panels; the library supplies the resize cursor and keyboard support.
const gutter = "w-1 bg-background hover:bg-ring/60 aria-[orientation=horizontal]:h-1";

const mobileQuery = "(max-width: 639px)";
const subscribeMobile = (change: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(mobileQuery);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const isMobile = () => typeof window.matchMedia === "function" && window.matchMedia(mobileQuery).matches;

export function NearTerminal({ view = "trade" }: { view?: "trade" | "portfolio" } = {}) {
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  const [mobileInsightsOpen, setMobileInsightsOpen] = useState(false);
  const [marketStatsOpen, setMarketStatsOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<"markets" | "trade">("markets");
  const [showLevels, updateShowLevels] = useState(true);
  const visibilityVersion = useRef(0);
  useEffect(() => {
    const version = visibilityVersion.current;
    const timer = window.setTimeout(() => { if (visibilityVersion.current === version) updateShowLevels(chartLevelsPreference.read() ?? true); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const setShowLevels = (show: boolean) => { visibilityVersion.current++; updateShowLevels(show); chartLevelsPreference.write(show); };
  const [chatReview, setChatReview] = useState<{ walletId: string; order: OutlayerReview }>();
  const [pair, setPair] = useState<SelectedPair>(DEFAULT_PAIR);
  const catalog = useCatalogQuery();
  // The last opened asset is restored once the catalog arrives. Until then the market panels show
  // skeletons instead of flashing the default asset; a failed catalog falls back to the default.
  const [pendingAssetId, setPendingAssetId] = useState(() => selectedAssetPreference.read() ?? null);
  if (pendingAssetId && catalog.data) {
    setPendingAssetId(null);
    const base = selectableTradingAssets(catalog.data.assets, catalog.data.tokens).find(asset => asset.assetId === pendingAssetId && asset.assetId !== DEFAULT_PAIR.quote.assetId);
    if (base) setPair(makePair(base, DEFAULT_PAIR.quote));
  }
  const awaitingAsset = !!pendingAssetId && pendingAssetId !== DEFAULT_PAIR.base.assetId && !catalog.isError;
  useEffect(() => {
    if (!catalog.data) return;
    const saved = selectedAssetPreference.read();
    if (saved && !selectableTradingAssets(catalog.data.assets, catalog.data.tokens).some(asset => asset.assetId === saved && asset.assetId !== DEFAULT_PAIR.quote.assetId)) selectedAssetPreference.remove();
  }, [catalog.data]);
  const [tradingBusy, setTradingBusy] = useState(false);
  const { market: dataMarket, intentsMarket, error: dataMarketError, isPending: dataMarketPending } = useAssetMarket(pair.base.assetId);
  const dataDegraded = useDataDegraded();
  const intentsMarketId = view === "portfolio" || awaitingAsset ? undefined : intentsMarket?.id;
  const marketTicker = useMarketTicker(view === "portfolio" || awaitingAsset ? undefined : dataMarket?.id);
  const intentsTrades = useIntentsTrades(intentsMarketId);
  // Exchange stats while the asset has (or may still have) a data-API market; token-market metrics otherwise.
  const reference = !!dataMarket || (dataMarket === undefined && !dataMarketError);
  // Jev analyzes the reference market; only its matching plan can be drawn.
  const jev = dataMarket && !awaitingAsset ? jevMarket(dataMarket) : undefined;
  const analysis = useChartAnalysis(pair.base.assetId, view === "trade" && !!jev);
  const savedPlan = analysis.entryPlan;
  const entryPlan = savedPlan && (savedPlan.market
    ? !!jev && savedPlan.market.assetId === jev.assetId && savedPlan.market.source === jev.source && savedPlan.market.quote === jev.quote && savedPlan.market.symbol === jev.symbol
    : pair.base.assetId === DEFAULT_PAIR.base.assetId && jev?.source === "Binance" && jev.quote === "USDC") ? savedPlan : null;
  const tokenMarkets = useQuery({ queryKey: ["near", "token-markets"], queryFn: ({ signal }) => getTokenMarkets(signal), staleTime: 300_000, refetchInterval: query => query.state.error ? 30_000 : 300_000 });
  const metrics = tokenMarkets.data?.assets[pair.base.assetId];
  const { session, refreshSession, setSession, clearAccount } = useTerminalData();
  const state = session.data ?? null;
  const accountUnavailable = session.isPending || !session.data || !!session.error || session.failureCount > 0;
  const showAccountError = session.isError;
  const ticker = marketTicker.ticker;
  const [marketNow, setMarketNow] = useState(0);
  const [logoutAttempt, setLogoutAttempt] = useState<{ accountId: string | null } | null>(null);
  const busy = logoutAttempt !== null && logoutAttempt.accountId === (state?.account?.id ?? null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const mounted = useRef(true);
  const currentAccount = useRef(state?.account?.id ?? null);
  const accountVersion = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { currentAccount.current = state?.account?.id ?? null; accountVersion.current += 1; }, [state?.account?.id]);
  const [signOutAccount, setSignOutAccount] = useState<string | null>(null);
  const signOutOpen = signOutAccount !== null && signOutAccount === state?.account?.id;
  const setSignOutOpen = (open: boolean) => setSignOutAccount(open ? state?.account?.id ?? null : null);
  const connecting = useRef(false);
  const [selectedDeposit, setSelectedDeposit] = useState<TrackedDepositQuote | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  function openTransfer(direction: "deposit" | "withdraw") {
    if (accountUnavailable) return;
    if (direction === "deposit") { setSelectedDeposit(null); setDepositOpen(true); }
    else setWithdrawOpen(true);
  }
  const [tradePanel, updateTradePanel] = useState<TradePanel>(() => activityTabPreference.read() ?? "balances");
  function setTradePanel(next: TradePanel) { updateTradePanel(next); activityTabPreference.write(next); }
  const panel = tradePanel === "intents-trades" && !intentsMarketId ? "balances" : tradePanel;
  const refresh = refreshSession;
  useEffect(() => {
    const timer = setInterval(() => setMarketNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  async function authenticate() {
    if (!mounted.current || connecting.current || busy || accountUnavailable || !state) return;
    connecting.current = true;
    const version = accountVersion.current;
    setConnectionBusy(true);
    try {
      const connected = await signIn("login", () => {});
      if (!mounted.current || version !== accountVersion.current) return;
      if (!currentAccount.current) clearAccount();
      await setSession(connected);
    } catch (e) { if (mounted.current && version === accountVersion.current && !currentAccount.current) toast.error(passkeyError(e)); }
    finally { connecting.current = false; if (mounted.current) setConnectionBusy(false); }
  }
  async function signOut() {
    if (!mounted.current || busy) return;
    const version = accountVersion.current;
    const active = () => mounted.current && version === accountVersion.current;
    const attempt = { accountId: state?.account?.id ?? null };
    setLogoutAttempt(attempt);
    try {
      await logout();
      if (!active()) return;
      clearAccount();
      await refresh();
      if (!mounted.current || (version !== accountVersion.current && currentAccount.current)) return;
      setSignOutOpen(false);
    } catch (e) { if (active()) toast.error(e instanceof Error ? e.message : TOAST_MESSAGES.signOutFailed); }
    finally { if (mounted.current) setLogoutAttempt(current => current === attempt ? null : current); }
  }
  const account = state?.account?.kind === "passkey" ? state.account : null;
  const [selectedWalletId, storeWalletSelection] = useStoredSelection(account ? `dya:terminal:selected-wallet:${account.id}` : null);
  const tradingWallet = selectedWalletId ? account?.tradingWallets?.find(wallet => wallet.id === selectedWalletId) : undefined;
  const chartOrders = useOrders(accountUnavailable || tradingWallet ? null : account?.id ?? null);
  const tradingOpenOrders = useQuery({
    queryKey: ["id", "trading-open-orders", tradingWallet?.id],
    queryFn: () => readTradingOpenOrders(tradingWallet!.id),
    enabled: !accountUnavailable && !!tradingWallet,
    refetchInterval: 30_000,
  });
  const trading = useTradingWallet(accountUnavailable ? undefined : tradingWallet?.id, catalog.data?.assets ?? []);
  const baseUsdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
  const withdrawalSource: WithdrawalSource | undefined = tradingWallet && {
    assetId: baseUsdc,
    balances: { ...trading.balance, data: trading.assets ? { assets: trading.assets } : undefined },
    async prepare(input) {
      if (!("originAssetId" in input) || input.originAssetId !== baseUsdc || input.destinationAssetId !== baseUsdc) throw new Error("Choose USDC on Base.");
      const [whole, fraction = ""] = input.amount.split(".");
      const quote = await estimateTradingWithdrawal(tradingWallet.id, input.wallet, BigInt(whole + fraction.padEnd(6, "0")).toString());
      const { options } = await prepareTradingWithdrawalApproval(tradingWallet.id, quote.id);
      const raw = quote.estimatedRawAmount.padStart(7, "0");
      return { options, id: quote.id, review: { asset: "USDC", amount: input.amount, destinationWallet: input.wallet, expectedReceive: `${raw.slice(0, -6)}.${raw.slice(-6)}`, deadline: quote.deadline } };
    },
    submit(assertion, id) {
      if (!id) throw new Error("Trading withdrawal review unavailable.");
      return approveTradingWithdrawal(tradingWallet.id, id, assertion);
    },
    status: id => readTradingWithdrawal(tradingWallet.id, id),
    onUpdated() { void trading.balance.refetch(); void trading.activity.refetch(); },
  };
  function selectWallet(id: string | null) {
    if (!account || accountUnavailable || busy || tradingBusy || depositOpen || withdrawOpen || fundingOpen) return;
    storeWalletSelection(id);
  }
  const orderLines = useMemo(() => accountUnavailable || chartOrders.error ? [] : chartOrderLines(chartOrders.data ?? [], pair, dataMarket?.quote, catalog.error ? [] : catalog.data?.assets ?? [], marketNow), [accountUnavailable, chartOrders.error, chartOrders.data, pair, dataMarket?.quote, catalog.error, catalog.data, marketNow]);
  const tradingOrderLines = useMemo(() => accountUnavailable || tradingOpenOrders.isError ? [] : chartLinesForPair(
    (tradingOpenOrders.data?.orders ?? []).filter(order => order.base_asset === pair.base.assetId &&
      order.quote_asset === pair.quote.assetId && !order.is_payout_status_final &&
      ["open", "partially_filled"].includes(order.fill_status.toLowerCase())).map(order => ({
        id: order.order_id, price: Number(order.price), side: order.side,
        text: `${order.side === "buy" ? "Buy" : "Sell"} limit · ${formatNumber(order.price, { format: "price" })} ${displaySymbol(pair.quote)}`,
      })), pair, dataMarket?.quote, catalog.error ? [] : catalog.data?.assets ?? [], marketNow
  ), [accountUnavailable, tradingOpenOrders.isError, tradingOpenOrders.data, pair, dataMarket?.quote, catalog.error, catalog.data, marketNow]);
  const statsLoading = awaitingAsset || (reference ? !ticker && (dataMarketPending || marketTicker.isPending) : !metrics && tokenMarkets.isPending);
  const capLoading = awaitingAsset || (!metrics && tokenMarkets.isPending);
  const headerPrice = reference ? (ticker ? Number(ticker.lastPrice) : undefined) : metrics?.price;
  const titlePrice = statsLoading ? "-" : formatNumber(headerPrice, { format: "price", unit: "USD" });
  const marketTitle = `${displaySymbol(pair.base)} · ${DYA_BRAND.name}`;
  useEffect(() => {
    document.title = view === "portfolio" ? `Portfolio · ${DYA_BRAND.name}` : awaitingAsset ? `${DYA_BRAND.name}` : titlePrice === "-" ? marketTitle : `${titlePrice} · ${marketTitle}`;
    return () => { document.title = `${DYA_BRAND.name}`; };
  }, [view, awaitingAsset, marketTitle, titlePrice]);
  const headerChange = reference ? ticker?.changePercent : metrics?.change24h;
  const changeOpen = reference ? Number(ticker?.openPrice) : headerPrice != null && headerChange != null && headerChange > -100 ? headerPrice / (1 + headerChange / 100) : NaN;
  const headerChangeAmount = headerPrice != null && Number.isFinite(changeOpen) && changeOpen > 0 ? headerPrice - changeOpen : null;
  const headerVolume = reference ? (ticker ? Number(ticker.quoteVolume) : undefined) : metrics?.volume24h;
  const headerCap = metrics?.marketCap;
  const sizingPrice = sizingReferencePrice(pair.base.assetId, pair.quote.assetId, marketTicker.live && ticker && dataMarket ? { price: Number(ticker.lastPrice), quote: dataMarket.quote } : undefined, catalog.error ? [] : catalog.data?.assets ?? [], marketNow);
  const limitLastPrice = intentsLastPrice(intentsTrades.error ? undefined : intentsTrades.data, catalog.error ? undefined : catalog.data?.assets.find(asset => asset.assetId === pair.quote.assetId), marketNow);
  const dataFeeds: FeedHealth[] = [
    { name: "Account", essential: true, state: feedState(session.isPending, !!session.data, !!session.error) },
    // The asset catalog (1Click) gates trading; its outage leaves our charts and prices serving, so it isn't essential.
    { name: "Trading", state: dataDegraded ? "Unavailable" : feedState(catalog.isPending, !!catalog.data, !!catalog.error) },
    { name: "Market overview", state: feedState(tokenMarkets.isPending, !!tokenMarkets.data && Object.keys(tokenMarkets.data.assets).length > 0, !!tokenMarkets.error, !!tokenMarkets.data && marketNow - tokenMarkets.data.updatedAt < TOKEN_MARKETS_FRESH_MS) },
    ...(view === "trade" && dataMarket !== null ? [
      { name: "Prices", state: feedState(dataMarketPending || marketTicker.isPending, !!ticker, !!dataMarketError || !!marketTicker.error || marketTicker.status === "reconnecting", marketTicker.live) },
    ] : []),
  ];
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const columns = useDefaultLayout({ id: "dya-terminal-columns", storage: layoutStorage });
  const rows = useDefaultLayout({ id: "dya-terminal-rows", storage: layoutStorage });
  const marketHeader = <MarketHeader pair={pair} assets={selectableTradingAssets(catalog.data?.assets ?? [], catalog.data?.tokens)}
    awaitingAsset={awaitingAsset} statsLoading={statsLoading} capLoading={capLoading} headerPrice={headerPrice} headerChange={headerChange}
    headerChangeAmount={headerChangeAmount} headerVolume={headerVolume} headerCap={headerCap} mobile={mobile}
    marketStatsOpen={marketStatsOpen} setMarketStatsOpen={setMarketStatsOpen} tradingBusy={tradingBusy}
    catalogUnavailable={catalog.isError} catalogRetrying={catalog.isFetching} retryCatalog={() => void catalog.refetch()}
    onSelect={base => { setPendingAssetId(null); setPair(makePair(base, DEFAULT_PAIR.quote)); selectedAssetPreference.write(base.assetId); }} />;
  // Outage notice above the market header; it shares the column with the chart rather than overlaying it.
  const degraded = serviceDegraded(dataDegraded, catalog.isError);
  const degradedBanner = view === "trade" && degraded ? <ServiceDegradedBanner className="shrink-0 rounded-none border-x-0 border-t-0" /> : null;
  const insightControls = <JevSettings analysis={analysis} showLevels={showLevels} onShowLevelsChange={setShowLevels} />;
  const chart = awaitingAsset
    ? <section className="dia-panel flex min-h-0 min-w-0 flex-1 flex-col px-2 pb-1 pt-2" aria-busy="true"><div className="flex min-h-0 flex-1 items-center justify-center sm:min-h-[370px] lg:min-h-0"><DyaLoader label="Loading chart" /></div></section>
    : <NearChart key={pair.base.assetId} asset={pair.base} orderLines={tradingWallet ? tradingOrderLines : orderLines} entryPlan={showLevels ? entryPlan : null} />;
  const activity = <ActivityPanel tradingLimits={tradingWallet ? { walletId: tradingWallet.id, orders: tradingOpenOrders } : undefined} trading={tradingWallet ? trading : undefined} key={tradingWallet?.id ?? account?.id ?? "disconnected"} accountId={accountUnavailable ? null : account?.id ?? null} pair={pair} allMarketsOnly={view === "portfolio"} showBalanceWarning={view !== "portfolio"} marketId={view === "portfolio" ? undefined : intentsMarketId} value={panel} onChange={setTradePanel} className={`dia-panel min-h-0 gap-0 overflow-hidden ${view === "portfolio" ? "min-h-[360px] rounded-lg border" : desktop ? "h-full" : mobile ? "min-h-40 flex-1" : "h-[360px]"}`} openTransfers={() => openTransfer("deposit")} openDeposit={quote => { setSelectedDeposit(quote); setDepositOpen(true); }} />;
  function reviewChatDraft(draft: Draft) {
    if (!tradingWallet || draft.walletId !== tradingWallet.id || accountUnavailable || busy || tradingBusy) return;
    const base = catalog.data?.assets.find(asset => asset.assetId === draft.baseAssetId);
    const quote = catalog.data?.assets.find(asset => asset.assetId === draft.quoteAssetId);
    if (!base || !quote) {
      toast.error("This draft’s market is unavailable.");
      return;
    }
    try {
      const size = draft.sizeUnit === "quote"
        ? new D(draft.size).div(draft.limitPrice).toDecimalPlaces(base.decimals, D.ROUND_DOWN).toFixed()
        : draft.size;
      const expiryHours = ({ "1h": 1, "24h": 24, "7d": 168 } as Record<string, number>)[draft.expiry];
      if (!expiryHours) throw new Error("Invalid expiry");
      setChatReview({ walletId: tradingWallet.id, order: {
        id: crypto.randomUUID(), base: base.assetId, quote: quote.assetId, side: draft.side,
        rawAmount: quantityRaw(size, base.decimals), price: draft.limitPrice, expiryHours,
      } });
      setPendingAssetId(null);
      setPair(makePair(base, quote));
      setMobileSection("trade");
    } catch {
      toast.error("This draft’s size or expiry is invalid.");
    }
  }
  const ticket = <aside inert={accountUnavailable || awaitingAsset} aria-busy={accountUnavailable || awaitingAsset} className={`dia-panel min-w-0 ${desktop ? "h-full overflow-y-auto" : mobile ? "min-h-0 max-h-[65%] shrink-0 overflow-y-auto" : "min-h-full"}`}>{tradingWallet ? <OrderTicket key={`${tradingWallet.id}:${pair.id}`} account={account} pair={pair} unavailable={accountUnavailable} chatReview={chatReview?.walletId === tradingWallet.id ? chatReview.order : undefined} onChatReviewOpened={() => setChatReview(undefined)} outlayer={{ id: tradingWallet.id, wallet: trading, onSwapSubmitted: () => setTradePanel("orders") }} marketPrice={sizingPrice} lastPrice={limitLastPrice} signIn={() => void authenticate()} onBusyChange={setTradingBusy} /> : awaitingAsset
    ? <OrderTicketLoading />
    : <OrderTicket onMoveToTrading={() => setFundingOpen(true)} unavailable={accountUnavailable} suspended={degraded} key={`${account?.id ?? "disconnected"}:${pair.id}`} pair={pair} onBusyChange={setTradingBusy} account={account} marketPrice={sizingPrice} lastPrice={limitLastPrice} signIn={() => void authenticate()} />}</aside>;
  const portfolio = <Portfolio trading={tradingWallet ? trading : undefined} key={tradingWallet?.id ?? account?.id ?? "disconnected"} accountId={accountUnavailable ? null : account?.id ?? null} loading={accountUnavailable} busy={busy || connectionBusy} connect={() => void authenticate()} deposit={() => openTransfer("deposit")} withdraw={() => openTransfer("withdraw")} activity={activity} />;
  return <main className={`dia-terminal flex flex-col bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] text-foreground sm:pb-0 ${view === "trade" && (desktop || mobile) ? "h-dvh min-h-0 overflow-hidden" : "min-h-dvh"}`}>
    <nav className="sticky top-0 z-40 mb-1 flex h-14 shrink-0 flex-nowrap lg:h-12 items-center justify-between gap-2 bg-background px-3 text-xs sm:px-4 lg:px-2">
      <div className="flex h-10 items-center gap-2 sm:h-full sm:gap-8">        <DropdownMenu open={navigationOpen} onOpenChange={setNavigationOpen}><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="sm:hidden" aria-label={navigationOpen ? "Close navigation menu" : "Open navigation menu"}/>}><MenuToggleIcon open={navigationOpen}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-44">
          {APP_NAVIGATION.map(item => <DropdownMenuItem key={item.label} render={<a href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined} aria-current={view === item.view ? "page" : undefined}/>}>{item.label === "DOCS" ? <BookOpen/> : <NavigationIcon active={view === item.view} icon={item.view === "portfolio" ? "portfolio" : "trade"} className="size-4"/>}{item.label === "TRADE" ? "Trade" : item.label === "PORTFOLIO" ? "Portfolio" : "Docs"}{view === item.view && <Check className="ml-auto"/>}{item.external && <ExternalLink className="ml-auto"/>}</DropdownMenuItem>)}
          {view === "trade" && <><DropdownMenuSeparator/><DropdownMenuItem onClick={() => setMobileInsightsOpen(true)}><InsightsIcon/>Insights</DropdownMenuItem></>}
        </DropdownMenuContent></DropdownMenu><a href="/" aria-label={`${DYA_BRAND.name} home`} className="flex shrink-0 items-center"><BrandLogo size={14} name={DYA_BRAND.name} nameClassName="hidden sm:inline" /></a><div className="hidden items-center gap-1 sm:flex">{APP_NAVIGATION.filter(item => item.view !== null).map(item => <a key={item.label} href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined} aria-current={view === item.view ? "page" : undefined} aria-label={item.external ? `${item.label} (opens in a new tab)` : undefined} className={buttonVariants({ variant: "ghost", className: `h-8! rounded-[6px]! px-3 text-xs ${view === item.view ? "text-foreground" : "text-muted-foreground"} hover:bg-transparent hover:text-foreground dark:hover:bg-transparent` })}>{item.label}</a>)}</div></div>
      <div className="flex items-center gap-2">{showAccountError && <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><span>Account connection unavailable</span><Button size="sm" variant="ghost" disabled={session.isFetching} onClick={() => void session.refetch()}>{session.isFetching ? "Reconnecting…" : "Retry"}</Button></div>}{view === "trade" && <InsightsMenu key={pair.base.assetId} asset={pair.base} mobile={mobile} open={mobile ? mobileInsightsOpen : undefined} onOpenChange={setMobileInsightsOpen} controls={insightControls} headerAction={<JevRefresh enabled={!!jev} analysis={analysis} />}/>}<div inert={accountUnavailable} className="flex items-center gap-2" aria-busy={accountUnavailable}>{account ? <><Button size="sm" className="hidden sm:inline-flex" onClick={() => openTransfer("deposit")}>Deposit</Button><WalletMenu key={account.id} tradingWallet={tradingWallet} onSelectWallet={selectWallet} busy={busy || tradingBusy || depositOpen || withdrawOpen || fundingOpen} account={account} idOrigin={state?.passkeyOrigin} onDeposit={() => openTransfer("deposit")} onWithdraw={() => openTransfer("withdraw")} onFunding={() => setFundingOpen(true)} onSignOut={() => setSignOutOpen(true)} onActivity={() => { setMobileSection("markets"); setTradePanel("transfers"); }} /></> : <><Button size="sm" disabled={!state || busy || connectionBusy} onClick={() => void authenticate()}>{connectionBusy && <LoaderCircle className="size-4 " />}{connectionBusy ? TOAST_MESSAGES.connecting : "Connect"}</Button></>}</div>

      </div>
    </nav>
    {!mobile && view === "portfolio" ? portfolio : desktop ? <div className="min-h-0 flex-1 px-1"><ResizablePanelGroup orientation="horizontal" className="bg-background" defaultLayout={columns.defaultLayout} onLayoutChanged={columns.onLayoutChanged}>
      <ResizablePanel id="terminal-market" minSize={560} className="flex h-full min-w-0 flex-col gap-1 bg-background">
        {degradedBanner}{marketHeader}
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1" defaultLayout={rows.defaultLayout} onLayoutChanged={rows.onLayoutChanged}>
          <ResizablePanel id="terminal-chart" defaultSize="75%" minSize={260} className="flex h-full min-w-0">{chart}</ResizablePanel>
          <ResizableHandle aria-label="Resize chart and activity" className={gutter} />
          <ResizablePanel id="terminal-activity" defaultSize="25%" minSize={120} maxSize="80%" className="h-full">{activity}</ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle aria-label="Resize order ticket" className={gutter} />
      <ResizablePanel id="terminal-ticket" defaultSize={320} minSize={300} maxSize={560} className="h-full">{ticket}</ResizablePanel>
    </ResizablePanelGroup></div> : mobile ? <>
      {view === "portfolio" && portfolio}
      <div className={view === "portfolio" ? "hidden" : "flex min-h-0 flex-1 flex-col [&>header]:shrink-0"}>
        {degradedBanner}{marketHeader}
        <section aria-label="Markets view" className={mobileSection === "markets" ? "flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto bg-background" : "hidden"}>
          <div className="flex min-h-[200px] min-w-0 flex-[2_1_0%]">{chart}</div>{activity}
        </section>
        <section aria-label="Trade view" className={mobileSection === "trade" ? "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-background" : "hidden"}>{ticket}{activity}</section>
      </div>
    </> : <div className="grid flex-1 gap-1 bg-background">
      <div className="flex min-h-0 min-w-0 flex-col gap-1 bg-background">{degradedBanner}{marketHeader}<div className="flex min-h-[520px] min-w-0 flex-1">{chart}</div>{activity}</div>
      {ticket}
    </div>}
    <footer className="mt-auto hidden shrink-0 items-center justify-between gap-3 bg-background px-1 py-1 sm:flex">
      <div className="flex items-center"><nav aria-label="DYA links" className="flex items-center"><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="DYA on X" render={<a href={DYA_URLS.x} target="_blank" rel="noopener noreferrer" />}><XIcon /></Button><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="DYA on Telegram" render={<a href={DYA_URLS.telegram} target="_blank" rel="noopener noreferrer" />}><TelegramIcon /></Button><Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Documentation (opens in a new tab)" render={<a href={DYA_URLS.docs} target="_blank" rel="noopener noreferrer" />} />}><BookOpenFilled aria-hidden="true" /></TooltipTrigger><TooltipContent>Documentation</TooltipContent></Tooltip><Tooltip><TooltipTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground" aria-label="Charts powered by Vela (opens in a new tab)" render={<a href={VELA_URL} target="_blank" rel="noopener noreferrer" />} />}>Vela</TooltipTrigger><TooltipContent>Charts powered by Vela</TooltipContent></Tooltip></nav><FeedbackDialog key={account?.id ?? "signed-out"} accountId={account?.id ?? null} /></div>
      <div className="flex items-center">{shortRelease && <span className="font-mono text-xs text-muted-foreground"><span className="sr-only">Build </span>{shortRelease}</span>}<DataStatus feeds={dataFeeds} /><JevChat market={view === "trade" && !awaitingAsset ? { baseAssetId: pair.base.assetId, quoteAssetId: pair.quote.assetId } : undefined} onReview={reviewChatDraft} key={tradingWallet?.id ?? account?.id} walletId={tradingWallet?.id} connected={!!account && !accountUnavailable} /></div>
    </footer>
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] sm:hidden">
      <AnimatedNavLink icon="markets" href="/" aria-current={view !== "portfolio" && mobileSection === "markets" ? "page" : undefined} onClick={() => setMobileSection("markets")} className="flex h-14 items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-4px]">Markets</AnimatedNavLink>
      <AnimatedNavLink icon="trade" href="/" aria-current={view !== "portfolio" && mobileSection === "trade" ? "page" : undefined} onClick={() => setMobileSection("trade")} className="flex h-14 items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-4px]">Trade</AnimatedNavLink>
      <AnimatedNavLink icon="portfolio" href="/portfolio" aria-current={view === "portfolio" ? "page" : undefined} className="flex h-14 items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-4px]">Portfolio</AnimatedNavLink>
      <JevChat market={view === "trade" && !awaitingAsset ? { baseAssetId: pair.base.assetId, quoteAssetId: pair.quote.assetId } : undefined} onReview={reviewChatDraft} key={tradingWallet?.id ?? account?.id} walletId={tradingWallet?.id} connected={!!account && !accountUnavailable} />
    </nav>
    <DialogDrawer open={fundingOpen && !accountUnavailable} onOpenChange={setFundingOpen}><DialogDrawerContent className="max-h-[85dvh] overflow-y-auto">{account && <FundingDialog key={account.id} accountId={account.id} onComplete={() => setFundingOpen(false)} onDetails={() => { setFundingOpen(false); setTradePanel("transfers"); }} />}</DialogDrawerContent></DialogDrawer>
    <DialogDrawer open={depositOpen && !accountUnavailable} onOpenChange={setDepositOpen}><DialogDrawerContent className="max-h-[85dvh] overflow-y-auto"><LegacyDepositForm key={`${account?.id ?? "disconnected"}:${selectedDeposit?.id ?? "new"}`} accountId={account?.id ?? ""} initialQuote={selectedDeposit} tradingWalletId={tradingWallet?.id} onMoveToTrading={tradingWallet ? undefined : () => { setDepositOpen(false); setFundingOpen(true); }} onClose={() => setDepositOpen(false)} onDetails={() => { setDepositOpen(false); setMobileSection("markets"); setTradePanel("transfers"); }} /></DialogDrawerContent></DialogDrawer>
    <DialogDrawer open={withdrawOpen && !accountUnavailable} onOpenChange={setWithdrawOpen}><DialogDrawerContent className="max-h-[85dvh] overflow-y-auto"><WithdrawalForm withdrawalSource={withdrawalSource} key={account?.id ?? "disconnected"} accountId={account?.id ?? ""} onClose={() => setWithdrawOpen(false)} onDetails={() => { setWithdrawOpen(false); setMobileSection("markets"); setTradePanel("transfers"); }} /></DialogDrawerContent></DialogDrawer>
    <SignOutDialog open={signOutOpen && !accountUnavailable} onOpenChange={setSignOutOpen} busy={busy} onConfirm={() => void signOut()} />
  </main>;
}
