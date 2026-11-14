// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "@dya/ui/lib/toast";
vi.mock("@dya/ui/lib/toast", () => ({ toast: vi.fn() }));
import { FundingDialog } from "@/components/near/funding-dialog";
import { authorizeFunding, cancelFunding, fundingHistory, fundingStatus, prepareFunding, submitFunding } from "@/lib/near/http/funding-conversions-client";
import { startAuthentication } from "@dya/wallet-sdk";
import { batch, balances, catalog } from "./fixtures/funding";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
import { unlockBalances } from "@/lib/near/client/sign-in";
vi.mock("@dya/ui/components/dialog-drawer", () => ({ DialogDrawerHeader: "header", DialogDrawerTitle: "h2", DialogDrawerDescription: "p" }));
const useBalanceQuery = vi.hoisted(() => vi.fn());
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useBalanceQuery }));
vi.mock("@/lib/near/client/sign-in", () => ({ unlockBalances: vi.fn(async () => {}), passkeyError: (error: unknown) => String(error) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => ({ assets: catalog }) }));
vi.mock("@/lib/near/http/funding-conversions-client", () => ({ authorizeFunding: vi.fn(), cancelFunding: vi.fn(), fundingHistory: vi.fn(), fundingStatus: vi.fn(), prepareFunding: vi.fn(), submitFunding: vi.fn() }));
// jsdom has no slide geometry. Test the guide's state and acknowledgement here;
// the actual Embla navigation is verified in Storybook.
vi.mock("embla-carousel-react", () => ({ default: () => [() => {}, undefined] }));
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn(async () => ({})) }));
beforeEach(() => { localStorage.setItem("dya:funding-trading-guide:v1:account", "seen"); vi.clearAllMocks(); useBalanceQuery.mockReturnValue({ data: balances }); vi.mocked(fundingHistory).mockResolvedValue({ operations: [] }); vi.mocked(authorizeFunding).mockResolvedValue({ options: { challenge: "test" } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const complete = vi.fn();
  const view = render(<QueryClientProvider client={client}><FundingDialog accountId="account" onComplete={complete} /></QueryClientProvider>);
  return { client, complete, finish: () => { view.unmount(); client.clear(); } };
}
it("reviews all funding balances together, signs each route and keeps completion visible until Done", async () => {
  const operation = batch();
  vi.mocked(prepareFunding).mockResolvedValue({ operation });
  vi.mocked(submitFunding).mockImplementation(async () => {
    operation.updatedAt += 1;
    operation.legs.find(l => l.state === "ready")!.state = "submitted"; operation.state = "processing";
    vi.mocked(fundingHistory).mockResolvedValue({ operations: [structuredClone(operation)] });
    vi.mocked(fundingStatus).mockResolvedValue({ operation: structuredClone(operation) });
    return { operation: structuredClone(operation) };
  });
  const { client, complete, finish } = renderDialog();
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  expect(screen.getByLabelText("Selected funding value")).toHaveTextContent("$2.00");
  expect(screen.getByRole("button", { name: "Show funding breakdown" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(prepareFunding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(submitFunding).toHaveBeenCalledTimes(2));
  expect(startAuthentication).toHaveBeenCalledTimes(2);
  expect(complete).not.toHaveBeenCalled();
  operation.legs.forEach(l => { l.state = "settled"; }); operation.state = "settled"; operation.updatedAt += 1;
  vi.mocked(fundingStatus).mockResolvedValue({ operation });
  await client.invalidateQueries({ queryKey: ["near", "account", "account", "funding"] });
  await screen.findByText("Transfer complete");
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(complete).toHaveBeenCalledTimes(1);
  expect(prepareFunding).toHaveBeenCalledWith(balances.assets.map(a => ({ assetId: a.assetId, amount: "1" })));
  finish();
});
it("keeps a partial batch visible when a later passkey prompt is cancelled", async () => {
  const operation = batch();
  vi.mocked(prepareFunding).mockResolvedValue({ operation });
  vi.mocked(startAuthentication).mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error("Passkey cancelled"));
  vi.mocked(submitFunding).mockImplementationOnce(async () => {
    operation.legs[0].state = "settled"; operation.state = "partial"; operation.updatedAt += 1;
    return { operation: structuredClone(operation) };
  });
  vi.mocked(cancelFunding).mockImplementationOnce(async () => { operation.legs[1].state = "cancelled"; operation.updatedAt += 1; return { operation: structuredClone(operation) }; });
  const { complete, finish } = renderDialog();
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  await screen.findByText("Transfer partially completed");
  expect(submitFunding).toHaveBeenCalledTimes(1); expect(cancelFunding).toHaveBeenCalledWith("batch");
  expect(complete).not.toHaveBeenCalled(); finish();
});
it("shows authorization failure without a passkey prompt and offers remaining balances after cancellation", async () => {
  const operation = batch();vi.mocked(prepareFunding).mockResolvedValue({ operation });
  vi.mocked(authorizeFunding).mockRejectedValueOnce(new Error("1Click execution is not configured"));
  vi.mocked(cancelFunding).mockImplementationOnce(async () => ({ operation: { ...operation, updatedAt: operation.updatedAt + 1, state: "cancelled", legs: operation.legs.map(l => ({ ...l, state: "cancelled" })) } }));
  const { finish } = renderDialog();await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByText("1Click execution is not configured")).toBeVisible();expect(screen.getByText("Transfer cancelled")).toBeVisible();
  expect(startAuthentication).not.toHaveBeenCalled();expect(submitFunding).not.toHaveBeenCalled();expect(cancelFunding).toHaveBeenCalledExactlyOnceWith("batch");
  fireEvent.click(screen.getByRole("button", { name: "Review remaining balances" }));expect(await screen.findByRole("button", { name: "Continue" })).toBeEnabled();expect(prepareFunding).toHaveBeenCalledOnce();finish();
});
it("keeps the authorization error visible if cancelling unsigned funding routes fails", async () => {
  const operation = batch();vi.mocked(prepareFunding).mockResolvedValue({ operation });vi.mocked(authorizeFunding).mockRejectedValueOnce(new Error("Synthetic authorization unavailable"));vi.mocked(cancelFunding).mockRejectedValueOnce(new Error("Synthetic cancel unavailable"));
  const { finish } = renderDialog();await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByText("Synthetic authorization unavailable")).toBeVisible();await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  expect(authorizeFunding).toHaveBeenCalledOnce();expect(cancelFunding).toHaveBeenCalledOnce();expect(startAuthentication).not.toHaveBeenCalled();expect(submitFunding).not.toHaveBeenCalled();finish();
});
it("stops later funding confirmations after an uncertain first submission and never offers automatic resubmission", async () => {
  const operation = batch();vi.mocked(prepareFunding).mockResolvedValue({ operation });
  const unknown = { ...operation, updatedAt: operation.updatedAt + 1, state: "unknown" as const, legs: operation.legs.map((leg, i) => ({ ...leg, state: i === 0 ? "unknown" as const : "ready" as const })) };
  vi.mocked(submitFunding).mockResolvedValueOnce({ operation: unknown });vi.mocked(cancelFunding).mockResolvedValueOnce({ operation: { ...unknown, updatedAt: unknown.updatedAt + 1, legs: unknown.legs.map(l => l.state === "ready" ? { ...l, state: "cancelled" as const } : l) } });
  const { finish } = renderDialog();await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByText("Checking your transfer")).toBeVisible();expect(screen.getByText("A submission outcome is uncertain. Check its status before trying again.")).toBeVisible();
  expect(authorizeFunding).toHaveBeenCalledTimes(1);expect(startAuthentication).toHaveBeenCalledTimes(1);expect(submitFunding).toHaveBeenCalledTimes(1);expect(cancelFunding).toHaveBeenCalledExactlyOnceWith("batch");expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();expect(screen.queryByRole("button", { name: "Review remaining balances" })).toBeNull();finish();
});


it.each(["settled", "failed"] as const)("keeps a reopened funding operation visible when polling reaches %s", async terminal => {
  const operation = batch();operation.state = "processing";operation.legs.forEach(leg => { leg.state = "submitted"; });
  vi.mocked(fundingHistory).mockImplementation(async () => ({ operations: [structuredClone(operation)] }));
  vi.mocked(fundingStatus).mockImplementation(async () => ({ operation: structuredClone(operation) }));
  const { client, complete, finish } = renderDialog();
  try {
    expect(await screen.findByText("Transfer processing")).toBeVisible();
    operation.state = terminal;operation.legs.forEach(leg => { leg.state = terminal; });operation.updatedAt += 1;
    await act(async () => { await client.invalidateQueries({ queryKey: ["near", "account", "account", "funding"] }); });
    expect(await screen.findByText(terminal === "settled" ? "Transfer complete" : "Transfer couldn’t be completed")).toBeVisible();
    expect(complete).not.toHaveBeenCalled();
    expect(prepareFunding).not.toHaveBeenCalled();expect(startAuthentication).not.toHaveBeenCalled();expect(submitFunding).not.toHaveBeenCalled();
    if (terminal === "settled") { fireEvent.click(screen.getByRole("button", { name: "Done" }));expect(complete).toHaveBeenCalledOnce(); }
    else { fireEvent.click(screen.getByRole("button", { name: "Review remaining balances" }));expect(await screen.findByRole("button", { name: "Continue" })).toBeEnabled(); }
  } finally { finish(); }
});


it.each(["settled", "failed", "cancelled", "partial"] as const)("preserves a confirmed %s funding outcome when history refresh fails", async terminal => {
  const operation = batch();operation.state = "processing";operation.legs.forEach(leg => { leg.state = "submitted"; });
  vi.mocked(fundingHistory).mockImplementation(async () => ({ operations: [structuredClone(operation)] }));
  vi.mocked(fundingStatus).mockImplementation(async () => ({ operation: structuredClone(operation) }));
  const { client, complete, finish } = renderDialog();
  const title = { settled: "Transfer complete", failed: "Transfer couldn’t be completed", cancelled: "Transfer cancelled", partial: "Transfer partially completed" }[terminal];
  try {
    await screen.findByText("Transfer processing");
    operation.state = terminal;operation.legs.forEach((leg, i) => { leg.state = terminal === "partial" ? i === 0 ? "settled" : "failed" : terminal; });operation.updatedAt += 1;
    await act(async () => { await client.invalidateQueries({ queryKey: ["near", "account", "account", "funding"] }); });
    await screen.findByText(title);
    vi.mocked(fundingHistory).mockRejectedValueOnce(new Error("Synthetic history unavailable"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["near", "account", "account", "funding"] }); });
    expect(await screen.findByText("Status updates are unavailable. Showing the confirmed transfer outcome.")).toBeVisible();
    expect(screen.getByText(title)).toBeVisible();expect(screen.queryByText("Unable to check transfer")).toBeNull();
    if (terminal === "settled") expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("Status updates are unavailable. Showing the confirmed transfer outcome.")).toBeNull());
    expect(screen.getByText(title)).toBeVisible();expect(complete).not.toHaveBeenCalled();
    expect(prepareFunding).not.toHaveBeenCalled();expect(startAuthentication).not.toHaveBeenCalled();expect(submitFunding).not.toHaveBeenCalled();
  } finally { finish(); }
});
it.each(["processing", "unknown"] as const)("keeps a %s funding outcome uncertain when history refresh fails", async state => {
  const operation = batch();operation.state = state;operation.legs.forEach(leg => { leg.state = state === "unknown" ? "unknown" : "submitted"; });
  vi.mocked(fundingHistory).mockImplementation(async () => ({ operations: [structuredClone(operation)] }));
  vi.mocked(fundingStatus).mockImplementation(async () => ({ operation: structuredClone(operation) }));
  const { client, finish } = renderDialog();
  try {
    await screen.findByText(state === "unknown" ? "Checking your transfer" : "Transfer processing");
    vi.mocked(fundingHistory).mockRejectedValueOnce(new Error("Synthetic history unavailable"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["near", "account", "account", "funding"] }); });
    expect(await screen.findByText("Unable to check transfer")).toBeVisible();
    expect(screen.queryByText("Status updates are unavailable. Showing the confirmed transfer outcome.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(state === "unknown" ? "Checking your transfer" : "Transfer processing")).toBeVisible();
    expect(prepareFunding).not.toHaveBeenCalled();expect(startAuthentication).not.toHaveBeenCalled();expect(submitFunding).not.toHaveBeenCalled();
  } finally { finish(); }
});

it.each(["authorization", "authentication", "submission"] as const)("stops remaining funding work after unmount while %s is pending", async stage => {
  const operation = batch();
  const submitted = structuredClone(operation);submitted.legs[0].state = "submitted";submitted.state = "processing";
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(prepareFunding).mockResolvedValue({ operation });
  vi.mocked(authorizeFunding).mockReset().mockImplementation(async () => { if (stage === "authorization") await gate;return { options: { challenge: "synthetic" } }; });
  vi.mocked(startAuthentication).mockReset().mockImplementation(async () => { if (stage === "authentication") await gate;return {} as never; });
  vi.mocked(submitFunding).mockReset().mockImplementation(async () => { if (stage === "submission") await gate;return { operation: submitted }; });
  const { complete, finish } = renderDialog();
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(stage === "authorization" ? authorizeFunding : stage === "authentication" ? startAuthentication : submitFunding).toHaveBeenCalledOnce());
  finish();
  await act(async () => { release(); });
  expect(authorizeFunding).toHaveBeenCalledOnce();
  expect(startAuthentication).toHaveBeenCalledTimes(stage === "authorization" ? 0 : 1);
  expect(submitFunding).toHaveBeenCalledTimes(stage === "submission" ? 1 : 0);
  expect(cancelFunding).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
});
it("does not launch cancellation from a retired funding dialog after late device failure", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(prepareFunding).mockResolvedValue({ operation: batch() });
  vi.mocked(authorizeFunding).mockReset().mockResolvedValue({ options: { challenge: "synthetic" } });
  vi.mocked(startAuthentication).mockReset().mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
  const { finish } = renderDialog();
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(startAuthentication).toHaveBeenCalledOnce());
  finish();
  await act(async () => { reject(new Error("Synthetic retired device failure")); });
  expect(submitFunding).not.toHaveBeenCalled();expect(cancelFunding).not.toHaveBeenCalled();
  expect(authorizeFunding).toHaveBeenCalledOnce();
});

it.each(["click", "authorization", "authentication", "first submission"] as const)("stops expired funding work at the %s boundary and refreshes only unsigned routes", async stage => {
  const operation = batch(), deadline = Date.now() + 60000;
  operation.expiresAt = new Date(deadline).toISOString();
  const submitted = structuredClone(operation);submitted.legs[0].state = "submitted";submitted.state = "processing";submitted.updatedAt += 1;
  const refreshed = structuredClone(operation);refreshed.id = "refreshed";refreshed.expiresAt = new Date(deadline + 60000).toISOString();
  if (stage === "first submission") refreshed.legs = [refreshed.legs[1]];
  let release!: () => void;const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(prepareFunding).mockReset().mockResolvedValueOnce({ operation }).mockResolvedValueOnce({ operation: refreshed });
  vi.mocked(authorizeFunding).mockReset().mockImplementation(async () => { if (stage === "authorization") await gate;return { options: { challenge: "synthetic" } }; });
  vi.mocked(startAuthentication).mockReset().mockImplementation(async () => { if (stage === "authentication") await gate;return {} as never; });
  vi.mocked(submitFunding).mockReset().mockImplementation(async () => { if (stage === "first submission") await gate;return { operation: submitted }; });
  const { finish } = renderDialog();
  try {
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    if (stage === "click") { operation.expiresAt = new Date(Date.now() - 1).toISOString(); }
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    if (stage !== "click") {
      await waitFor(() => expect(stage === "authorization" ? authorizeFunding : stage === "authentication" ? startAuthentication : submitFunding).toHaveBeenCalledOnce());
      vi.spyOn(Date, "now").mockReturnValue(deadline);
      await act(async () => { release(); });
    }
    expect(authorizeFunding).toHaveBeenCalledTimes(stage === "click" ? 0 : 1);
    expect(startAuthentication).toHaveBeenCalledTimes(["click", "authorization"].includes(stage) ? 0 : 1);
    expect(submitFunding).toHaveBeenCalledTimes(stage === "first submission" ? 1 : 0);
    expect(cancelFunding).not.toHaveBeenCalled();
    const refresh = await screen.findByRole("button", { name: "Refresh quote" });
    expect(refresh).toBeEnabled();
    vi.mocked(authorizeFunding).mockImplementation(() => new Promise(() => {}));
    fireEvent.click(refresh);
    await waitFor(() => expect(prepareFunding).toHaveBeenCalledTimes(2));
    expect(prepareFunding).toHaveBeenLastCalledWith((stage === "first submission" ? balances.assets.slice(1) : balances.assets).map(a => ({ assetId: a.assetId, amount: "1" })));
    expect(submitFunding).toHaveBeenCalledTimes(stage === "first submission" ? 1 : 0);
  } finally { finish(); }
});

it("keeps an unknown source valuation unavailable instead of assuming stablecoin parity", async () => {
  const asset = catalog.find(asset => asset.assetId === "base-usdc")!;
  const price = asset.price;
  delete asset.price;
  const { finish } = renderDialog();
  try {
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.getByLabelText("Selected funding value")).toHaveTextContent("-");
  } finally { finish(); asset.price = price; }
});

it("opens ID directly after preparing routes without a second Terminal review", async () => {
  vi.mocked(prepareFunding).mockResolvedValue({ operation: batch() });
  vi.mocked(startAuthentication).mockReset().mockImplementation(() => new Promise(() => {}));
  const { finish } = renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await waitFor(() => expect(startAuthentication).toHaveBeenCalledOnce());
  expect(authorizeFunding).toHaveBeenCalledWith("batch", "0");
  expect(screen.queryByText("Estimated trading balance added")).toBeNull();
  expect(screen.queryByText("Minimum received (all routes)")).toBeNull();
  expect(screen.queryByRole("button", { name: /Confirm transfer/ })).toBeNull();
  expect(submitFunding).not.toHaveBeenCalled();
  finish();
});


it("toasts cancellation and cancels unsigned funding routes without submitting", async () => {
  const operation = batch();
  vi.mocked(prepareFunding).mockResolvedValue({ operation });
  vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
  const cancelled = { ...operation, state: "cancelled" as const, legs: operation.legs.map(leg => ({ ...leg, state: "cancelled" as const })) };
  vi.mocked(cancelFunding).mockResolvedValueOnce({ operation: cancelled });
  const { finish } = renderDialog();
  try {
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Confirmation cancelled"));
    expect(cancelFunding).toHaveBeenCalledWith(operation.id);
    expect(submitFunding).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  } finally { finish(); }
});

it("explains Funding versus Trading once and remembers acknowledgement", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.removeItem("dya:funding-trading-guide:v1:account");
  const first = renderDialog();
  expect(await screen.findByRole("region", { name: "Funding and Trading explained" })).toBeVisible();
  expect(screen.getByText("Deposits arrive in Funding")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("region", { name: "Funding and Trading explained" })).toBeNull();
  first.finish();
  const second = renderDialog();
  await screen.findByRole("button", { name: "Continue" });
  expect(screen.queryByRole("region", { name: "Funding and Trading explained" })).toBeNull();
  second.finish();
  localStorage.removeItem("dya:funding-trading-guide:v1:account");
});

it("offers a passkey unlock, not a dead-end retry, when confidential balance access has expired", async () => {
  useBalanceQuery.mockReturnValue({ error: new ConfidentialAccessRequired(), refetch: vi.fn(), isFetching: false });
  const { finish } = renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: "Unlock balances" }));
  await waitFor(() => expect(unlockBalances).toHaveBeenCalledOnce());
  expect(screen.queryByText(/Funding data is unavailable/)).toBeNull();
  finish();
});
