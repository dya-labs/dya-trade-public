import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { CatalogAsset } from "@/lib/near/domain/catalog";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { prepareMarketOrder, previewMarketOrder } from "@/lib/near/http/trading-client";
import type { MarketReview } from "@/lib/near/http/schemas/trading";
import { NearTerminal } from "@/components/near/terminal";
const state = vi.hoisted(() => ({
  balances: [] as { assetId: string; symbol: string; decimals: number; raw: string; amount: string }[],
  catalog: undefined as { assets: CatalogAsset[] } | undefined,
  session: { data: { account: null } as { account: { id: string; kind: "passkey" } | null } | undefined, failureCount: 0, error: null as Error | null, isError: false, isPending: false, isFetching: false },
  retrySession: vi.fn(),
  intentsMarketId: undefined as string | undefined,
}));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: state.catalog }) }));
vi.mock("@/components/near/use-terminal-data", () => ({ useTerminalData: () => ({ session: { ...state.session, refetch: state.retrySession }, refreshSession: vi.fn(), clearAccount: vi.fn() }) }));
vi.mock("@/lib/market-data/hooks", () => ({ useIntentsTrades: () => ({}), useAssetMarket: () => ({ market: null, intentsMarket: state.intentsMarketId ? { id: state.intentsMarketId } : null }), useMarketTicker: () => ({}), useDataDegraded: () => null }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: async () => ({ updatedAt: Date.now(), assets: {} }) }));
vi.mock("@/components/near/chart", () => ({ NearChart: ({ asset }: { asset: CatalogAsset }) => <div data-testid="chart">{asset.assetId}</div> }));
vi.mock("@/components/near/asset-selector", () => ({ AssetSelector: ({ assets, onSelect }: { assets: CatalogAsset[]; onSelect: (asset: CatalogAsset) => void }) => <button onClick={() => onSelect(assets.find(asset => asset.symbol === "BTC")!)}>Choose BTC</button> }));
vi.mock("@/components/near/wallet-menu", () => ({ WalletMenu: () => null }));
vi.mock("@/components/near/funding-dialog", () => ({ FundingDialog: () => null }));
vi.mock("@/components/near/transfers", () => ({ LegacyDepositForm: () => null, WithdrawalForm: () => null }));
vi.mock("@/components/near/backup-passkey", () => ({ BackupPasskey: () => null }));
vi.mock("@/components/near/intents-trades", () => ({ IntentsTrades: () => null }));
vi.mock("@/components/near/insights-menu", () => ({ InsightsMenu: () => null }));
vi.mock("@/components/near/confidential-access", () => ({ ConfidentialAccess: () => null }));
vi.mock("@/components/near/data-status", () => ({ DataStatus: () => null, feedState: () => "ready" }));

vi.mock("@/components/near/orders", () => ({ Orders: () => null }));
vi.mock("@/components/near/market-trades", () => ({ MarketTrades: () => null }));
vi.mock("@/components/near/transfer-activity", () => ({ TransferActivity: () => null }));
vi.mock("@/components/near/use-live-balances", () => ({
  useBalanceQuery: () => ({ data: { assets: state.balances } }),
  useLiveBalances: (id: string | null) => ({ balances: id ? { accountId: id, blockHeight: 1, checkedAt: 1, assets: state.balances } : null, balanceError: "", accessRequired: false, loading: false, refresh: vi.fn() }),
}));
vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: vi.fn(() => new Promise(() => {})), prepareMarketOrder: vi.fn() }));
const base = { ...DEFAULT_PAIR.base, coingeckoId: "near" };
const variant = { ...base, assetId: "nep141:synthetic-near-on-base", blockchain: "base" };
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); localStorage.clear(); state.catalog = undefined; state.balances = []; });
function mount() {
  vi.mocked(previewMarketOrder).mockReset().mockImplementation(() => new Promise(() => {}));
  vi.mocked(prepareMarketOrder).mockReset();
  state.session.data = { account: { id: "account-a", kind: "passkey" } };
  state.catalog = { assets: [base, variant, DEFAULT_PAIR.quote] };
  state.balances = [base, variant, DEFAULT_PAIR.quote].map(asset => ({ ...asset, raw: "2000000", amount: "2" }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  const tree = () => <QueryClientProvider client={client}><NearTerminal /></QueryClientProvider>;
  const view = render(tree());
  return () => view.rerender(tree());
}
async function enterVariantDraft() {
  fireEvent.click(screen.getByRole("combobox", { name: "NEAR balance" }));
  const option = await screen.findByRole("option", { name: "Base · 2 wNEAR" });
  fireEvent.pointerDown(option, { button: 0 });fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "NEAR balance" })).toHaveTextContent("Base · 2 wNEAR"));
  fireEvent.click(screen.getByRole("tab", { name: "Sell" }));
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  expect(screen.getByLabelText("Size", { exact: true })).toHaveValue("1");
}
it("resets selected network and actual ticket draft when Terminal changes account", async () => {
  const rerender = mount();await enterVariantDraft();
  state.session.data = { account: { id: "account-b", kind: "passkey" } };rerender();
  expect(screen.getByRole("combobox", { name: "NEAR balance" })).toHaveTextContent("NEAR · 2 NEAR");
  expect(screen.getByLabelText("Size", { exact: true })).toHaveValue("");
  expect(screen.getByRole("tab", { name: "Buy" })).toHaveAttribute("aria-selected", "true");
});
it("preserves selected network and actual draft on same-account refresh then clears them on sign-out", async () => {
  const rerender = mount();await enterVariantDraft();
  state.session.data = { account: { id: "account-a", kind: "passkey" } };rerender();
  expect(screen.getByRole("combobox", { name: "NEAR balance" })).toHaveTextContent("Base · 2 wNEAR");
  expect(screen.getByLabelText("Size", { exact: true })).toHaveValue("1");
  state.session.data = { account: null };rerender();
  expect(screen.queryByRole("combobox", { name: "NEAR balance" })).toBeNull();
  expect(screen.getByLabelText("Size", { exact: true })).toHaveValue("");
});
it("resets the actual draft to the canonical identity when its selected variant leaves the catalog", async () => {
  const rerender = mount();await enterVariantDraft();
  state.catalog = { assets: [base, DEFAULT_PAIR.quote] };rerender();
  expect(screen.queryByRole("combobox", { name: "NEAR balance" })).toBeNull();
  expect(screen.getByLabelText("Size", { exact: true })).toHaveValue("");
  expect(screen.getByRole("tab", { name: "Buy" })).toHaveAttribute("aria-selected", "true");
});

function preparedReview(): MarketReview {
  return { pair: DEFAULT_PAIR, confidentiality: "advanced", orderType: "market", side: "buy", quantity: "1", inputSymbol: "USDC", outputSymbol: "NEAR", principal: "0.5", estimatedOutput: "1", minimumOutput: "0.99", available: "2", shortfall: "0", balanceBlock: 1, slippageBps: 100, expiresAt: new Date(Date.now() + 60000).toISOString(), submissionEnabled: true, inputRaw: "500000", outputRaw: "1000000000000000000000000", depositAddress: "synthetic-only", depositMemo: null, correlationId: "synthetic-only" };
}
it.each(["success", "failure"] as const)("keeps the replacement account draft isolated from a late preparation %s", async outcome => {
  const rerender = mount();
  vi.mocked(previewMarketOrder).mockResolvedValue({ ...preparedReview(), submissionEnabled: false, timeEstimateSeconds: 30 });
  let resolve!: (value: Awaited<ReturnType<typeof prepareMarketOrder>>) => void;
  let reject!: (error: Error) => void;
  vi.mocked(prepareMarketOrder).mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  const review = await screen.findByRole("button", { name: "Review" }, { timeout: 2000 });
  await waitFor(() => expect(review).toBeEnabled(), { timeout: 2000 });
  fireEvent.click(review);
  await waitFor(() => expect(prepareMarketOrder).toHaveBeenCalledOnce());
  expect(prepareMarketOrder).toHaveBeenCalledOnce();
  state.session.data = { account: { id: "account-b", kind: "passkey" } };rerender();
  expect(screen.queryByRole("button", { name: "Prepare final quote" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "2" } });
  await act(async () => {
    if (outcome === "success") resolve({ review: preparedReview(), options: { challenge: "synthetic-only" } });
    else reject(new Error("Synthetic prior account diagnostic"));
  });
  expect(screen.getByLabelText("Size", { exact: true })).toHaveValue("2");
  expect(screen.queryByRole("button", { name: "Confirm and sign" })).toBeNull();
  expect(screen.queryByText("Synthetic prior account diagnostic")).toBeNull();
  expect(screen.getByRole("combobox", { name: "NEAR balance" })).toBeEnabled();
});

