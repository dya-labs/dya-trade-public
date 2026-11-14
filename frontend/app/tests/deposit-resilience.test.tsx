import { toast } from "@dya/ui/lib/toast";
vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
import { withTokenPolicy } from "./fixtures/token-policy";
import { approvedTestNetworks } from "./fixtures/network-policy";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LegacyDepositForm } from "@/components/near/transfers";
import { StandaloneWalletContext } from "@dya/wallet-ui/components/presentation";
import type { TrackedDepositQuote } from "@/lib/near/http/schemas/transfers";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { prepareDeposit } from "@dya/wallet-ui/lib/near/http/transfers-client";

const status = vi.hoisted(() => ({ value: "PENDING_DEPOSIT" as string | undefined, error: null as Error | null, refetch: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/use-deposit-status", () => ({ useDepositStatus: () => ({ data: status.value ? { status: status.value, terminal: ["SUCCESS", "FAILED", "REFUNDED"].includes(status.value) } : undefined, error: status.error, isFetching: false, refetch: status.refetch }) }));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => (withTokenPolicy({ networks: approvedTestNetworks, assets: [{ ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" }, { ...DEFAULT_PAIR.quote, assetId: "base-usdc", blockchain: "base", coingeckoId: "usd-coin" }] })) }));
vi.mock("@dya/wallet-ui/lib/near/http/transfers-client", () => ({ prepareDeposit: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => null }));
vi.mock("@dya/wallet-ui/components/near/network-mark", () => ({ NetworkMark: () => null }));
vi.mock("@dya/wallet-ui/lib/deposit-qr", () => ({ depositQrDataUrl: async () => "data:image/png;base64,dGVzdA==" }));
const clients: QueryClient[] = [];
beforeEach(() => { status.value = "PENDING_DEPOSIT"; status.error = null; vi.clearAllMocks(); vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(override: Partial<TrackedDepositQuote> = {}, existing = true, onBusyChange?: (busy: boolean) => void) {
  const quote: TrackedDepositQuote = {
    id: "deposit-resilience", direction: "deposit", confidentiality: "advanced", asset: "USDC", sourceChain: "Base", sourceNetwork: "base",
    sourceAssetId: "base-usdc", targetAssetId: "base-usdc", amount: "1", refundTo: "fixture-refund", recipient: "fixture-private-account",
    depositAddress: "0x1234567890123456789012345678901234567890", depositMemo: null,
    amountIn: "1000000", amountInFormatted: "1", amountOut: "1000000", amountOutFormatted: "1", minAmountOut: "990000",
    deadline: new Date(Date.now() + 600000).toISOString(), timeEstimateSeconds: 60, correlationId: "fixture-deposit", signature: "fixture-signature", submissionEnabled: true,
    ...override,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const component = () => <QueryClientProvider client={client}><StandaloneWalletContext.Provider value={true}><LegacyDepositForm accountId="deposit-resilience-account" initialQuote={existing ? quote : null} onClose={() => {}} onBusyChange={onBusyChange} /></StandaloneWalletContext.Provider></QueryClientProvider>;
  return { ...render(component()), quote, component, client };
}
function clipboard(writeText: ReturnType<typeof vi.fn>) {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return () => { if (original) Object.defineProperty(navigator, "clipboard", original); else Reflect.deleteProperty(navigator, "clipboard"); };
}
it.each(["address", "memo"] as const)("repeated deposit %s copies refresh the full confirmation lifetime", async part => {
  const writeText = vi.fn().mockResolvedValue(undefined), restore = clipboard(writeText);
  try {
    const { quote } = setup({ depositMemo: "EXACT-MEMO-42" });await screen.findByAltText(/QR code/);vi.useFakeTimers();
    const label = part === "address" ? "Copy address" : "Copy memo", copied = part === "address" ? "Address copied" : "Memo copied";
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
    act(() => vi.advanceTimersByTime(1500));await act(async () => { fireEvent.click(screen.getByRole("button", { name: copied })); });
    act(() => vi.advanceTimersByTime(501));expect(screen.getByRole("button", { name: copied })).toBeVisible();
    expect(writeText).toHaveBeenLastCalledWith(part === "address" ? quote.depositAddress : "EXACT-MEMO-42");
    act(() => vi.advanceTimersByTime(1499));expect(screen.getByRole("button", { name: label })).toBeVisible();
  } finally { restore(); }
});
it.each(["success", "failure"] as const)("an older address copy %s cannot overwrite a newer memo confirmation", async outcome => {
  const pending = Promise.withResolvers<void>(), writeText = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined), restore = clipboard(writeText);
  try {
    setup({ depositMemo: "EXACT-MEMO-42" });await screen.findByAltText(/QR code/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy address" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy memo" })); });
    // Clipboard writes themselves must stay ordered: these two fields differ.
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => { if (outcome === "success") pending.resolve();else pending.reject(new Error("Older denial")); });
    expect(screen.getByRole("button", { name: "Memo copied" })).toBeVisible();expect(screen.queryByText(/Unable to copy/)).toBeNull();
    expect(writeText).toHaveBeenLastCalledWith("EXACT-MEMO-42");
    expect(screen.getByText("EXACT-MEMO-42")).toBeVisible();
  } finally { restore(); }
});

it("never enables payment instructions for an already-expired deposit, including the exact cutoff", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  setup({ deadline: new Date(Date.now()).toISOString() });
  expect(screen.getByRole("heading", { name: "Deposit address expired" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  expect(screen.queryByAltText(/QR code/)).toBeNull();
  expect(screen.getByRole("button", { name: "Create new address" })).toBeEnabled();
});

it("uses the surrounding wallet close control while checking instead of adding a duplicate Close action", () => {
  status.value = undefined;
  setup();
  expect(screen.getByRole("heading", { name: "Checking your deposit" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
});

it("hides cached unpaid instructions when status refresh fails and restores them only after a successful check", async () => {
  const view = setup();
  await screen.findByAltText(/QR code/);
  status.error = new Error("Provider transport details must stay private"); view.rerender(view.component());
  expect(screen.getByRole("heading", { name: "Unable to check deposit" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  expect(screen.queryByAltText(/QR code/)).toBeNull();
  expect(screen.queryByText(/Provider transport details/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(status.refetch).toHaveBeenCalledOnce();
  status.error = null; view.rerender(view.component());
  expect(await screen.findByRole("button", { name: "Copy address" })).toBeEnabled();
});

it("keeps detected deposits in processing through a failed refresh without restoring payment instructions", () => {
  status.value = "PROCESSING"; status.error = new Error("offline"); setup();
  expect(screen.getByRole("heading", { name: "Deposit received" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
  expect(screen.queryByAltText(/QR code/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(status.refetch).toHaveBeenCalledOnce();
});

it("shows the full deposit address for manual copying and clears clipboard errors after a successful retry", async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValueOnce(undefined);
  const restore = clipboard(writeText);
  try {
    const { quote } = setup(); await screen.findByAltText(/QR code/);
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to copy address. Please select and copy it manually."));
    expect(screen.getByLabelText(quote.depositAddress)).toBeVisible();
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy address" })); });
    expect(screen.getByRole("button", { name: "Address copied" })).toBeVisible();
    expect(screen.queryByText(/Unable to copy address/)).toBeNull();
    expect(writeText).toHaveBeenLastCalledWith(quote.depositAddress);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole("button", { name: "Copy address" })).toBeVisible();
  } finally { restore(); }
});

it("handles a required memo clipboard failure and permits a successful retry", async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error("Clipboard denied")).mockResolvedValueOnce(undefined);
  const restore = clipboard(writeText);
  try {
    setup({ depositMemo: "123456789" }); await screen.findByAltText(/QR code/);
    fireEvent.click(screen.getByRole("button", { name: "Copy memo" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to copy memo. Please select and copy it manually."));
    expect(screen.getByText("123456789")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy memo" }));
    expect(await screen.findByRole("button", { name: "Memo copied" })).toBeVisible();
    expect(screen.queryByText(/Unable to copy memo/)).toBeNull();
    expect(writeText).toHaveBeenLastCalledWith("123456789");
  } finally { restore(); }
});

it("offers an explicit quote retry while retaining the selected deposit token and network", async () => {
  const { quote } = setup({}, false);
  vi.mocked(prepareDeposit).mockRejectedValueOnce(new Error("Deposit service temporarily unavailable. Please try again.")).mockResolvedValueOnce(quote);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Deposit network" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Deposit network" }));
  fireEvent.click(screen.getByRole("button", { name: "Base" }));
  fireEvent.click(screen.getByRole("button", { name: "Create deposit address" }));
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Copy address" })).toBeEnabled();
  expect(prepareDeposit).toHaveBeenCalledTimes(2);
  expect(prepareDeposit).toHaveBeenLastCalledWith({ sourceAssetId: "base-usdc", targetAssetId: "base-usdc" });
  expect(screen.queryByText(/Deposit service temporarily unavailable/)).toBeNull();
});


it.each(["success", "failure"] as const)("keeps refund addresses server-controlled while address creation is pending and handles %s", async outcome => {
  const { quote } = setup({ sourceChain: "NEAR", sourceNetwork: "near", sourceAssetId: DEFAULT_PAIR.quote.assetId, targetAssetId: DEFAULT_PAIR.quote.assetId }, false);
  const pending = Promise.withResolvers<TrackedDepositQuote>();
  vi.mocked(prepareDeposit).mockReset().mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Deposit network" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Deposit network" }));fireEvent.click(screen.getByRole("button", { name: "NEAR" }));
  expect(screen.queryByLabelText("Refund address on NEAR")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create deposit address" }));
  expect(prepareDeposit).toHaveBeenCalledWith({ sourceAssetId: DEFAULT_PAIR.quote.assetId, targetAssetId: DEFAULT_PAIR.quote.assetId });
  expect(screen.getByRole("heading", { name: "Creating deposit address…" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("USDC · NEAR");
  expect(screen.getByRole("list", { name: "Deposit steps" }).querySelector('[aria-current="step"]')).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByLabelText("Refund address on NEAR")).toBeNull();
  expect(screen.queryByRole("button", { name: "Deposit token" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Create deposit address" })).toBeNull();
  if (outcome === "success") {
    await act(async () => { pending.resolve(quote); });
    expect(await screen.findByRole("button", { name: "Copy address" })).toBeEnabled();
    expect(prepareDeposit).toHaveBeenCalledOnce();
  } else {
    await act(async () => { pending.reject(new Error("Synthetic prepare unavailable")); });
    expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByLabelText("Refund address on NEAR")).toBeNull();
    vi.mocked(prepareDeposit).mockResolvedValueOnce(quote);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Copy address" })).toBeEnabled();
    expect(prepareDeposit).toHaveBeenLastCalledWith({ sourceAssetId: DEFAULT_PAIR.quote.assetId, targetAssetId: DEFAULT_PAIR.quote.assetId });
    expect(prepareDeposit).toHaveBeenCalledTimes(2);
  }
});
it.each(["success", "failure"] as const)("retires deposit address creation on unmount before %s", async outcome => {
  const busy=vi.fn(),view=setup({},false,busy),pending=Promise.withResolvers<TrackedDepositQuote>();
  vi.mocked(prepareDeposit).mockReset().mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Continue"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Deposit network"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"Deposit network"}));fireEvent.click(screen.getByRole("button",{name:"Base"}));
  fireEvent.click(screen.getByRole("button",{name:"Create deposit address"}));expect(busy).toHaveBeenLastCalledWith(true);
  const invalidate=vi.spyOn(view.client,"invalidateQueries");view.unmount();
  expect.soft(busy).toHaveBeenLastCalledWith(false);const calls=busy.mock.calls.length;
  await act(async()=>{if(outcome==="success")pending.resolve(view.quote);else pending.reject(new Error("Retired prepare failed"));});
  expect(invalidate).not.toHaveBeenCalled();expect(busy).toHaveBeenCalledTimes(calls);
});
it.each(["success","failure"] as const)("drops queued deposit memo copy after unmount and pending address %s",async outcome=>{
  const pending=Promise.withResolvers<void>(),writeText=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined),restore=clipboard(writeText);
  try{
    const view=setup({depositMemo:"SYNTHETIC-RETIRED-MEMO"});await screen.findByAltText(/QR code/);
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Copy address"})));
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Copy memo"})));
    expect(writeText).toHaveBeenCalledOnce();view.unmount();
    await act(async()=>{if(outcome==="success")pending.resolve();else pending.reject(new Error("Old clipboard denied"));});
    expect(writeText).toHaveBeenCalledOnce();expect(writeText).toHaveBeenCalledWith(view.quote.depositAddress);
  }finally{restore();}
});
it.each(["expired","processing","status unavailable"] as const)("drops queued deposit memo copy when instructions become %s",async reason=>{
  const pending=Promise.withResolvers<void>(),writeText=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined),restore=clipboard(writeText);
  try{
    const view=setup({depositMemo:"SYNTHETIC-STALE-MEMO"});await screen.findByAltText(/QR code/);
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Copy address"})));
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Copy memo"})));
    if(reason==="expired")vi.spyOn(Date,"now").mockReturnValue(Date.parse(view.quote.deadline));
    else if(reason==="processing")status.value="PROCESSING";
    else status.error=new Error("Synthetic status unavailable");
    view.rerender(view.component());
    await act(async()=>pending.resolve());
    expect(writeText).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button",{name:"Memo copied"})).not.toBeInTheDocument();
  }finally{vi.restoreAllMocks();restore();}
});
