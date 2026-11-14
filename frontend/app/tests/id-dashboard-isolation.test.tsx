import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WalletDashboard } from "../../id/components/wallet-dashboard";
import { getSession, getAllBalances, registrationOptionsRequest, loginOptions, verifyRegistration, verifyLogin } from "@dya/wallet-ui/lib/near/http/account-client";
import { prepareConfidentialAccess, unlockConfidentialAccessWithBalances } from "@dya/wallet-ui/lib/near/http/confidential-client";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ConfidentialAccessRequired } from "@dya/wallet-ui/lib/near/domain/confidential-access-error";
const state = vi.hoisted(() => ({ client: null as QueryClient | null }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock("@dya/wallet-ui/components/wallet-query-provider", () => ({ WalletQueryProvider: ({ children }: { children: ReactNode }) => <QueryClientProvider client={state.client!}>{children}</QueryClientProvider> }));
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getSession: vi.fn(), getAllBalances: vi.fn(), registrationOptionsRequest: vi.fn(), loginOptions: vi.fn(), verifyRegistration: vi.fn(), verifyLogin: vi.fn(), logout: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/confidential-client", () => ({ prepareConfidentialAccess: vi.fn(), unlockConfidentialAccessWithBalances: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock("@dya/wallet-ui/components/wallet-assets", () => ({ WalletAssets: () => null }));
vi.mock("../../id/components/wallet-activity", () => ({ WalletActivity: () => null }));
vi.mock("../../id/components/wallet-recovery", () => ({ WalletRecovery: () => null }));
vi.mock("../../id/components/wallet-transfer", () => ({ WalletTransfer: () => null }));
vi.mock("../../id/components/wallet-page-header", () => ({ WalletPageHeader: () => null }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ account: null, passkeyOrigin: "https://id.example.test" });
  vi.mocked(getAllBalances).mockRejectedValue(new ConfidentialAccessRequired());
});
afterEach(() => { cleanup();state.client?.clear();state.client=null;vi.restoreAllMocks(); });
function mount(accountId: string | null) {
  state.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.client.setQueryData(["near", "session"], { account: accountId ? { id: accountId, kind: "passkey" } : null, passkeyOrigin: "https://id.example.test" });
  state.client.setQueryData(["near", "catalog"], { assets: [] });
  return render(<WalletDashboard />);
}
const signIns = (["register", "login"] as const).flatMap(kind => (["options", "device", "verification"] as const).map(stage => ({ kind, stage })));
it.each(signIns)("stops dashboard $kind after unmount during $stage", async ({ kind, stage }) => {
  let release!: () => void;const gate = new Promise<void>(resolve => { release=resolve; });
  async function step<T>(name: string, value: T): Promise<T> { if(stage===name)await gate;return value; }
  vi.mocked(registrationOptionsRequest).mockImplementation(() => step("options", {} as Awaited<ReturnType<typeof registrationOptionsRequest>>));
  vi.mocked(loginOptions).mockImplementation(() => step("options", {} as Awaited<ReturnType<typeof loginOptions>>));
  vi.mocked(startRegistration).mockImplementation(() => step("device", {} as Awaited<ReturnType<typeof startRegistration>>));
  vi.mocked(startAuthentication).mockImplementation(() => step("device", {} as Awaited<ReturnType<typeof startAuthentication>>));
  vi.mocked(verifyRegistration).mockImplementation(() => step("verification", { ok: true, session: { account: { id: "synthetic-registered", kind: "passkey" as const }, passkeyOrigin: "https://id.example.test" } }));
  vi.mocked(verifyLogin).mockImplementation(() => step("verification", { ok: true, confidentialUnlocked: false, session: { account: { id: "synthetic-logged-in", kind: "passkey" as const }, passkeyOrigin: "https://id.example.test" } }));
  const calls = kind==="register" ? [registrationOptionsRequest,startRegistration,verifyRegistration,getSession] : [loginOptions,startAuthentication,verifyLogin,getSession];
  const stop=["options","device","verification"].indexOf(stage),view=mount(null);
  fireEvent.click(screen.getByRole("button", { name: kind==="register" ? "Create account" : "Sign in" }));
  if (kind === "register") { fireEvent.click(screen.getByRole("button", { name: "Continue" })); fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test account" } }); fireEvent.click(screen.getByRole("button", { name: "Create account" })); }
  await waitFor(() => expect(calls[stop]).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => { release(); });
  for(const [i,call]of calls.entries())expect(call).toHaveBeenCalledTimes(i<=stop?1:0);
});
const unlocks = (["unmount", "account replacement"] as const).flatMap(mode => (["options", "device", "verification"] as const).map(stage => ({ mode, stage })));
it.each(unlocks)("stops dashboard unlock after $mode during $stage", async ({ mode, stage }) => {
  let release!: () => void;const gate = new Promise<void>(resolve => { release=resolve; });
  async function step<T>(name: string, value: T): Promise<T> { if(stage===name)await gate;return value; }
  vi.mocked(prepareConfidentialAccess).mockImplementation(() => step("options", { options: {} } as Awaited<ReturnType<typeof prepareConfidentialAccess>>));
  vi.mocked(startAuthentication).mockImplementation(() => step("device", {} as Awaited<ReturnType<typeof startAuthentication>>));
  vi.mocked(unlockConfidentialAccessWithBalances).mockImplementation(() => step("verification", { unlocked: true }));
  const view=mount("synthetic-old-account");
  fireEvent.click(await screen.findByRole("button", { name: "Unlock balances" }));
  const invalidate=vi.spyOn(state.client!, "invalidateQueries"),calls=[prepareConfidentialAccess,startAuthentication,unlockConfidentialAccessWithBalances,invalidate],stop=["options","device","verification"].indexOf(stage);
  await waitFor(() => expect(calls[stop]).toHaveBeenCalledOnce());
  if(mode==="unmount")view.unmount();
  else {
    await act(async () => { state.client!.setQueryData(["near","session"],{account:{id:"synthetic-replacement-account",kind:"passkey"},passkeyOrigin:"https://id.example.test"}); });
    expect.soft(await screen.findByRole("button", { name: "Unlock balances" })).toBeEnabled();
  }
  await act(async () => { release(); });
  for(const [i,call]of calls.entries())expect(call).toHaveBeenCalledTimes(i<=stop?1:0);
  if(mode==="account replacement")expect(screen.getByRole("button", { name: "Unlock balances" })).toBeEnabled();
});
