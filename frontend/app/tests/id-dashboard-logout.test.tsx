import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CatalogAsset } from "@/lib/near/domain/catalog";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "@dya/ui/lib/toast";
import { WalletDashboard } from "../../id/components/wallet-dashboard";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { getSession, logout, verifyLogin, verifyRegistration } from "@dya/wallet-ui/lib/near/http/account-client";
vi.mock("@dya/ui/lib/toast", () => ({ toast: vi.fn() }));
const state = vi.hoisted(() => ({ client: null as QueryClient | null, balanceAvailable: true, balanceError: false, holdings: [] as Array<{ symbol: string; assetId: string; decimals: number; raw: string; amount: string }> }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(async () => ({ id: "synthetic-login" })), startRegistration: vi.fn(async () => ({ id: "synthetic-register" })) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock("@dya/wallet-ui/components/wallet-query-provider", () => ({ WalletQueryProvider: ({ children }: { children: ReactNode }) => <QueryClientProvider client={state.client!}>{children}</QueryClientProvider> }));
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ logout: vi.fn(), loginOptions: vi.fn(async () => ({ challenge: "synthetic-login" })), registrationOptionsRequest: vi.fn(async () => ({ challenge: "synthetic-register" })), verifyLogin: vi.fn(async () => ({ ok: true, confidentialUnlocked: false, session: { account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" } })), verifyRegistration: vi.fn(async () => ({ ok: true, session: { account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" } })), getSession: vi.fn(async () => ({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" })) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: vi.fn(async () => ({ assets: [] })) }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: state.balanceAvailable ? { assets: state.holdings } : undefined, isError: state.balanceError }) }));
vi.mock("@dya/wallet-ui/components/wallet-assets", () => ({ WalletAssets: () => null }));
vi.mock("../../id/components/wallet-activity", () => ({ WalletActivity: () => null }));
vi.mock("../../id/components/wallet-recovery", () => ({ WalletRecovery: () => null }));
vi.mock("../../id/components/wallet-transfer", () => ({ WalletTransfer: ({ direction, onBack }: { direction: string; onBack: () => void }) => <section aria-label={`Synthetic ${direction} view`}><button onClick={onBack}>Back from synthetic transfer</button></section> }));
vi.mock("../../id/components/wallet-page-header", () => ({ WalletPageHeader: ({ onSignOut }: { onSignOut: () => void }) => <button onClick={onSignOut}>Open sign-out</button> }));
const privateKey = ["near", "account", "synthetic-wallet", "private-test"];
function mount(catalog: CatalogAsset[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); state.client = client;
  client.setQueryData(["near", "session"], { account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  client.setQueryData(privateKey, { synthetic: true });
  client.setQueryData(["near", "catalog"], { assets: catalog });
  render(<WalletDashboard />);
  fireEvent.click(screen.getByRole("button", { name: "Open sign-out" }));
  return screen.getByRole("alertdialog", { name: "Sign out?" });
}
afterEach(() => { cleanup(); state.client?.clear(); state.client = null; state.holdings = []; state.balanceAvailable = true; state.balanceError = false; vi.clearAllMocks(); });
it("preserves the signed-in session and private cache when sign-out is cancelled", async () => {
  const dialog = mount();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign out?" })).not.toBeInTheDocument());
  expect(logout).not.toHaveBeenCalled();
  expect(state.client!.getQueryData(privateKey)).toEqual({ synthetic: true });
  expect(screen.getByRole("button", { name: "Open sign-out" })).toBeInTheDocument();
});
it("retains session/cache on logout failure and clears private data on successful retry", async () => {
  vi.mocked(logout).mockRejectedValueOnce(new Error("Sign-out unavailable")).mockResolvedValue({ ok: true });
  const dialog = mount();
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Sign-out unavailable");
  expect(state.client!.getQueryData(privateKey)).toEqual({ synthetic: true });
  expect(state.client!.getQueryData(["near", "session"])).toMatchObject({ account: { id: "synthetic-wallet" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument();
  expect(state.client!.getQueryData(privateKey)).toBeUndefined();
  expect(state.client!.getQueryData(["near", "session"])).toMatchObject({ account: null });
  expect(state.client!.getQueryData(["near", "catalog"])).toEqual({ assets: [] });
});
it("waits for the logout response before clearing the session", async () => {
  let finish!: () => void;
  vi.mocked(logout).mockImplementation(() => new Promise<{ ok: true }>(resolve => { finish = () => resolve({ ok: true }); }));
  const dialog = mount();
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("button", { name: "Signing out…" })).toBeDisabled();
  expect(state.client!.getQueryData(privateKey)).toEqual({ synthetic: true });
  await act(async () => finish());
  expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument();
});

it("hides cached account actions during session failure and restores them after retry", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  vi.mocked(getSession).mockRejectedValueOnce(new Error("Session unavailable"));
  await act(async () => { await state.client!.invalidateQueries({ queryKey: ["near", "session"] }); });
  expect(await screen.findByRole("heading", { name: "Unable to load your account" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open sign-out" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Receive" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Open sign-out" })).toBeInTheDocument();
  expect(state.client!.getQueryData(privateKey)).toEqual({ synthetic: true });
});

it("recovers an initial session failure through a single Retry action and loading state", async () => {
  state.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(getSession).mockRejectedValueOnce(new Error("Initial outage"));
  render(<WalletDashboard />);
  expect(await screen.findByRole("heading", { name: "Unable to load your account" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  let finish!: (value: Awaited<ReturnType<typeof getSession>>) => void;
  vi.mocked(getSession).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Loading account…");
  expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  await act(async () => finish({ account: null, passkeyOrigin: "https://id.example.test" }));
  expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument();
});

it("keeps cached-account Retry disabled and controls hidden while recovery is pending", async () => {
  vi.mocked(getSession).mockResolvedValue({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  vi.mocked(getSession).mockRejectedValueOnce(new Error("Refresh outage"));
  await act(async () => { await state.client!.invalidateQueries({ queryKey: ["near", "session"] }); });
  expect(await screen.findByRole("heading", { name: "Unable to load your account" })).toBeInTheDocument();
  let finish!: (value: Awaited<ReturnType<typeof getSession>>) => void;
  vi.mocked(getSession).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Retrying…" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Open sign-out" })).not.toBeInTheDocument();
  await act(async () => finish({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" }));
  expect(await screen.findByRole("button", { name: "Open sign-out" })).toBeInTheDocument();
});

it.each([
  ["known", ["2", "3"], "$8.00", false],
  ["partly unknown", ["2", undefined], "$2.00", true],
  ["all unknown", [undefined, undefined], "-", true],
  ["zero string prices", ["0", "0"], "-", true],
  ["zero numeric prices", [0, 0], "-", true],
  ["partly zero", ["2", "0"], "$2.00", true],
] as const)("shows truthful portfolio valuation for %s prices", (_label, prices, expected, warning) => {
  vi.mocked(getSession).mockResolvedValue({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  state.holdings = ["A", "B"].map((symbol, index) => ({ symbol, assetId: symbol, decimals: 6, raw: String((index + 1) * 1000000), amount: String(index + 1) }));
  const catalog = state.holdings.map((asset, index) => ({ ...asset, blockchain: "near", price: prices[index] }));
  mount(catalog);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Estimated portfolio value")).toHaveTextContent(expected);
  expect(!!screen.queryByText("Some prices unavailable")).toBe(warning);
});
it.each([true, false])("distinguishes confirmed empty holdings from unavailable balances: available=%s", available => {
  vi.mocked(getSession).mockResolvedValue({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  state.balanceAvailable = available;
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Estimated portfolio value")).toHaveTextContent(available ? "$0.00" : "-");
  expect(screen.getByText(available ? "No funds yet. Receive assets to get started." : "Balances unavailable.")).toBeInTheDocument();
});

it.each(["Receive", "Send"])("opens %s and returns to the dashboard", action => {
  vi.mocked(getSession).mockResolvedValue({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  state.holdings = [{ symbol: "USDC", assetId: "synthetic-usdc", decimals: 6, raw: "1000000", amount: "1" }];
  mount([{ ...state.holdings[0], blockchain: "near", price: "1" }]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: action }));
  if (action === "Create account") { fireEvent.click(screen.getByRole("button", { name: "Continue" })); fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test account" } }); fireEvent.click(screen.getByRole("button", { name: "Create account" })); }
  expect(screen.getByRole("region", { name: `Synthetic ${action.toLowerCase()} view` })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back from synthetic transfer" }));
  expect(screen.getByRole("button", { name: "Open sign-out" })).toBeInTheDocument();
});
it.each(["empty", "unavailable", "refresh failure"])("disables Send for %s balances", condition => {
  vi.mocked(getSession).mockResolvedValue({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  state.holdings = condition === "empty" ? [] : [{ symbol: "USDC", assetId: "synthetic-usdc", decimals: 6, raw: "1000000", amount: "1" }];
  state.balanceAvailable = condition !== "unavailable"; state.balanceError = condition === "refresh failure";
  mount([{ assetId: "synthetic-usdc", symbol: "USDC", decimals: 6, blockchain: "near", price: "1" }]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
});

function mountSignedOut(recoveryMode: "provider" | "unavailable" = "unavailable") {
  state.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.client.setQueryData(["near", "session"], { account: null, passkeyOrigin: "https://id.example.test", recoveryMode });
  render(<WalletDashboard />);
}
it.each(["resolve", "reject"] as const)("preserves replacement session after retired ID logout %s", async outcome => {
  let finish!: () => void;
  vi.mocked(logout).mockImplementation(() => new Promise((resolve,reject) => {finish=()=>outcome === "resolve" ? resolve({ok:true}) : reject(new Error("Retired logout failed"));}));
  const dialog=mount();fireEvent.click(within(dialog).getByRole("button",{name:"Sign out"}));
  cleanup();
  const replacement={account:{id:"synthetic-new-wallet",kind:"passkey"},passkeyOrigin:"https://id.example.test"};
  state.client!.setQueryData(["near","session"],replacement);
  const replacementKey=["near","account","synthetic-new-wallet","private-test"];
  state.client!.setQueryData(replacementKey,{synthetic:true});
  await act(async()=>finish());
  expect(state.client!.getQueryData(["near","session"])).toEqual(replacement);
  expect(state.client!.getQueryData(replacementKey)).toEqual({synthetic:true});
});
it.each(["provider", "unavailable"] as const)("shows signed-out choices with conditional recovery: %s", mode => {
  mountSignedOut(mode);
  expect(screen.getByRole("heading", { name: "Get started" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  expect(!!screen.queryByRole("button", { name: "Recover" })).toBe(mode === "provider");
});
it.each(["Sign in", "Create account"])("completes the %s UI path using a mocked device ceremony", async action => {
  mountSignedOut();
  vi.mocked(getSession).mockResolvedValue({ account: { id: "synthetic-wallet", kind: "passkey" }, passkeyOrigin: "https://id.example.test" });
  fireEvent.click(screen.getByRole("button", { name: action }));
  if (action === "Create account") { fireEvent.click(screen.getByRole("button", { name: "Continue" })); fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test account" } }); fireEvent.click(screen.getByRole("button", { name: "Create account" })); }
  expect(await screen.findByRole("button", { name: "Open sign-out" })).toBeInTheDocument();
  if (action === "Sign in") { expect(startAuthentication).toHaveBeenCalledOnce(); expect(verifyLogin).toHaveBeenCalledOnce(); expect(startRegistration).not.toHaveBeenCalled(); }
  else { expect(startRegistration).toHaveBeenCalledOnce(); expect(verifyRegistration).toHaveBeenCalledOnce(); expect(startAuthentication).not.toHaveBeenCalled(); }
});
it.each(["Sign in", "Create account"])("keeps %s recoverable after a cancelled mocked ceremony", async action => {
  mountSignedOut();
  vi.mocked(action === "Sign in" ? startAuthentication : startRegistration).mockRejectedValueOnce(new DOMException("private browser detail", "NotAllowedError"));
  fireEvent.click(screen.getByRole("button", { name: action }));
  if (action === "Create account") { fireEvent.click(screen.getByRole("button", { name: "Continue" })); fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test account" } }); fireEvent.click(screen.getByRole("button", { name: "Create account" })); }
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Confirmation cancelled"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("private browser detail")).not.toBeInTheDocument();
  expect(verifyLogin).not.toHaveBeenCalled(); expect(verifyRegistration).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: action })).toBeEnabled();
});
