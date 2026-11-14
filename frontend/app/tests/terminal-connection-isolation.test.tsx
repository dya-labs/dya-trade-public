import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NearTerminal } from "@/components/near/terminal";
import { connect } from "@dya/wallet-sdk";
import { toast } from "@dya/ui/lib/toast";
const state = vi.hoisted(() => ({ clearAccount: vi.fn(), refresh: vi.fn(), setSession: vi.fn(), account: null as null | {id:string;kind: string} }));
vi.mock("@/lib/near/http/account-client", () => ({ logout: vi.fn() }));
vi.mock("@dya/ui/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [] } }) }));
vi.mock("@/components/near/use-terminal-data", () => ({ useTerminalData: () => ({ session: { data: { account: state.account }, failureCount: 0 }, clearAccount: state.clearAccount, refreshSession: state.refresh, setSession: state.setSession }) }));
vi.mock("@/lib/market-data/hooks", () => ({ useIntentsTrades: () => ({}), useAssetMarket: () => ({ market: null }), useMarketTicker: () => ({}), useDataDegraded: () => null }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: async () => ({ updatedAt: Date.now(), assets: {} }) }));
vi.mock("@/components/near/wallet-menu", () => ({ WalletMenu: ({ onSignOut }: { onSignOut: () => void }) => <button onClick={onSignOut}>Open settings</button> }));
vi.mock("@/components/near/chart", () => ({ NearChart: () => null }));
vi.mock("@/components/near/funded-ticket", () => ({ OrderTicket: () => null }));
vi.mock("@/components/near/asset-selector", () => ({ AssetSelector: () => null }));
vi.mock("@/components/near/funding-dialog", () => ({ FundingDialog: () => null }));
vi.mock("@/components/near/transfers", () => ({ LegacyDepositForm: () => null, WithdrawalForm: () => null }));
vi.mock("@/components/near/transfer-activity", () => ({ TransferActivity: () => null }));
vi.mock("@/components/near/backup-passkey", () => ({ BackupPasskey: () => null }));
vi.mock("@/components/near/orders", () => ({ Orders: () => null }));
vi.mock("@/components/near/market-trades", () => ({ MarketTrades: () => null }));
vi.mock("@/components/near/intents-trades", () => ({ IntentsTrades: () => null }));
vi.mock("@/components/near/insights-menu", () => ({ InsightsMenu: () => null }));
vi.mock("@/components/near/confidential-access", () => ({ ConfidentialAccess: () => null }));
vi.mock("@/components/near/data-status", () => ({ DataStatus: () => null, feedState: () => "ready" }));
vi.mock("@dya/wallet-sdk", () => ({ connect: vi.fn() }));
const clients: QueryClient[] = [];
beforeEach(() => { vi.resetAllMocks(); state.account = null; });
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); localStorage.clear(); });
function setup() {
  const client = new QueryClient(); clients.push(client);
  const ui = () => <QueryClientProvider client={client}><NearTerminal /></QueryClientProvider>;
  const view = render(ui());
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(connect).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  return { ...view, update: () => view.rerender(ui()) };
}
it.each(["resolve", "reject"] as const)("ignores connection %s after Terminal unmount", async outcome => {
  let finish!: () => void;
  vi.mocked(connect).mockImplementation(() => new Promise((resolve, reject) => { finish = () => outcome === "resolve" ? resolve({ account: { id: "synthetic-connected", kind: "passkey" }, passkeyOrigin: "http://localhost:3101" }) : reject(new Error("Old connection failed")); }));
  const view = setup(); expect(connect).toHaveBeenCalledOnce(); view.unmount();
  await act(async () => finish());
  expect(state.clearAccount).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
});
it.each(["resolve", "reject"] as const)("preserves a polled account during pending connection %s", async outcome => {
  let finish!: () => void;
  vi.mocked(connect).mockImplementation(() => new Promise((resolve, reject) => { finish = () => outcome === "resolve" ? resolve({ account: { id: "synthetic-connected", kind: "passkey" }, passkeyOrigin: "http://localhost:3101" }) : reject(new Error("Old connection failed")); }));
  const view = setup(); state.account = {id:"synthetic-new",kind:"passkey"}; view.update();
  fireEvent.click(screen.getByRole("button", {name:"Open settings"}));
  expect.soft(screen.getByRole("button", {name:"Sign out"})).toBeEnabled();
  await act(async () => finish());
  expect(state.clearAccount).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
it("suppresses session installation failure after Terminal unmount", async () => {
  let fail!: () => void;
  vi.mocked(connect).mockResolvedValue({ account: { id: "synthetic-connected", kind: "passkey" }, passkeyOrigin: "http://localhost:3101" });
  state.setSession.mockImplementation(() => new Promise((_, reject) => {fail = () => reject(new Error("Late refresh failed"));}));
  const view=setup(); await waitFor(() => expect(state.setSession).toHaveBeenCalledOnce()); view.unmount();
  await act(async () => fail()); expect(state.clearAccount).toHaveBeenCalledOnce(); expect(toast.error).not.toHaveBeenCalled();
});
it("installs the returned active connection once and locks duplicate clicks", async () => {
  let finish!: () => void;
  vi.mocked(connect).mockImplementation(() => new Promise(resolve => {finish = () => resolve({ account: { id: "synthetic-connected", kind: "passkey" }, passkeyOrigin: "http://localhost:3101" });}));
  setup(); const pending=screen.getByRole("button", {name:"Connecting…"}); expect(pending).toBeDisabled(); fireEvent.click(pending);
  expect(connect).toHaveBeenCalledOnce(); await act(async () => finish());
  expect(state.clearAccount).toHaveBeenCalledOnce(); expect(state.setSession).toHaveBeenCalledOnce(); expect(state.refresh).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
});
it("shows active connection failure and permits retry", async () => {
  vi.mocked(connect).mockRejectedValue(new Error("Connection unavailable")); setup();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Connection unavailable"));
  expect(screen.getByRole("button", {name:"Connect"})).toBeEnabled(); expect(state.clearAccount).not.toHaveBeenCalled();
});

