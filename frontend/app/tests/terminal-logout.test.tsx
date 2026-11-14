import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NearTerminal } from "@/components/near/terminal";
import { logout } from "@/lib/near/http/account-client";
import { toast } from "@dya/ui/lib/toast";
const state = vi.hoisted(() => ({ clearAccount: vi.fn(), refresh: vi.fn(), account: {id:"synthetic-wallet",kind:"passkey"}, update: () => {} }));
vi.mock("@/lib/near/http/account-client", () => ({ logout: vi.fn() }));
vi.mock("@dya/ui/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: [] } }) }));
vi.mock("@/components/near/use-terminal-data", () => ({ useTerminalData: () => ({ session: { data: { account: state.account, passkeyOrigin: "http://localhost:3101" }, failureCount: 0 }, clearAccount: state.clearAccount, refreshSession: state.refresh }) }));
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
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.resetAllMocks(); state.account={id:"synthetic-wallet",kind:"passkey"}; localStorage.clear(); });
function confirmation() {
  const client = new QueryClient(); clients.push(client);
  const ui=()=> <QueryClientProvider client={client}><NearTerminal /></QueryClientProvider>;
  const view=render(ui()); state.update=()=>view.rerender(ui());
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  return screen.getByRole("alertdialog", { name: "Sign out?" });
}
it("does not call logout when the confirmation is cancelled", async () => {
  const dialog = confirmation();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign out?" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Open settings" })).toBeVisible();
  expect(logout).not.toHaveBeenCalled();
  expect(state.clearAccount).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
});
it("retains confirmation and account state after logout failure, then clears and refreshes on retry", async () => {
  vi.mocked(logout).mockRejectedValueOnce(new Error("Sign-out unavailable")).mockResolvedValue({ ok: true });
  const dialog = confirmation();
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sign-out unavailable"));
  expect(screen.getByRole("alertdialog", { name: "Sign out?" })).toBeVisible();
  expect(state.clearAccount).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  expect(state.clearAccount).toHaveBeenCalledOnce();
  expect(state.clearAccount.mock.invocationCallOrder[0]).toBeLessThan(state.refresh.mock.invocationCallOrder[0]);
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Account settings" })).not.toBeInTheDocument());
});
it("shows pending logout without clearing state before the response", async () => {
  let finish!: () => void;
  vi.mocked(logout).mockImplementation(() => new Promise<{ ok: true }>(resolve => { finish = () => resolve({ ok: true }); }));
  const dialog = confirmation();
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("button", { name: "Signing out…" })).toBeDisabled();
  expect(state.clearAccount).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
});
it.each(["resolve", "reject"] as const)("ignores logout %s after Terminal unmount", async outcome => {
  let finish!: () => void;
  vi.mocked(logout).mockImplementation(() => new Promise((resolve, reject) => {finish=()=>outcome === "resolve" ? resolve({ok:true}) : reject(new Error("Retired sign-out failed"));}));
  const dialog=confirmation(); fireEvent.click(within(dialog).getByRole("button", {name:"Sign out"}));
  expect(logout).toHaveBeenCalledOnce(); cleanup();
  await act(async () => finish());
  expect(state.clearAccount).not.toHaveBeenCalled(); expect(state.refresh).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
});
it("suppresses logout refresh failure after Terminal unmount", async () => {
  let fail!: () => void;
  vi.mocked(logout).mockResolvedValue({ok:true});
  state.refresh.mockImplementation(() => new Promise((_,reject) => {fail=()=>reject(new Error("Retired logout refresh failed"));}));
  const dialog=confirmation();fireEvent.click(within(dialog).getByRole("button", {name:"Sign out"}));
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());cleanup();
  await act(async () => fail());expect(state.clearAccount).toHaveBeenCalledOnce();expect(toast.error).not.toHaveBeenCalled();
});
it.each(["resolve", "reject"] as const)("isolates replacement Terminal account during old logout %s",async outcome=>{
  let finish!:()=>void;
  vi.mocked(logout).mockImplementation(()=>new Promise((resolve,reject)=>{finish=()=>outcome==="resolve"?resolve({ok:true}):reject(new Error("Old logout failed"));}));
  const dialog=confirmation();fireEvent.click(within(dialog).getByRole("button",{name:"Sign out"}));
  state.account={id:"synthetic-new-wallet",kind:"passkey"};state.update();
  expect.soft(screen.queryByRole("button",{name:"Signing out…"})).not.toBeInTheDocument();
  await act(async()=>finish());
  expect(state.clearAccount).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled();expect(toast.error).not.toHaveBeenCalled();
});
it("keeps a replacement logout pending when the old account request finishes",async()=>{
  const finishes:Array<()=>void>=[];
  vi.mocked(logout).mockImplementation(()=>new Promise(resolve=>{finishes.push(()=>resolve({ok:true}));}));
  const oldDialog=confirmation();fireEvent.click(within(oldDialog).getByRole("button",{name:"Sign out"}));
  state.account={id:"synthetic-new-wallet",kind:"passkey"};state.update();
  fireEvent.click(screen.getByRole("button",{name:"Open settings"}));
  fireEvent.click(within(screen.getByRole("alertdialog",{name:"Sign out?"})).getByRole("button",{name:"Sign out"}));
  expect(logout).toHaveBeenCalledTimes(2);
  await act(async()=>finishes[0]());expect(screen.getByRole("button",{name:"Signing out…"})).toBeDisabled();
  expect(state.clearAccount).not.toHaveBeenCalled();expect(state.refresh).not.toHaveBeenCalled();
  await act(async()=>finishes[1]());expect(state.clearAccount).toHaveBeenCalledOnce();expect(state.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog",{name:"Sign out?"})).not.toBeInTheDocument();
});

