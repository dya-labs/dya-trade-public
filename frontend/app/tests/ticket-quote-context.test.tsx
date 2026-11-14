import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderTicketForm } from "@/components/near/ticket";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import type { Snapshot } from "@/lib/near/http/schemas/account";

const state = vi.hoisted(() => ({ amount: "10", preview: vi.fn() }));
vi.mock("@/lib/near/http/trading-client", () => ({ previewMarketOrder: (...args: unknown[]) => state.preview(...args) }));
vi.mock("@dya/wallet-ui/components/near/use-live-balances", () => ({ useLiveBalances: () => ({ balances: { assets: [{ ...DEFAULT_PAIR.quote, amount: state.amount }] }, balanceError: "", accessRequired: false, loading: false }) }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); state.preview.mockReset(); state.amount = "10"; });
function ticket() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  const view = () => <QueryClientProvider client={client}><OrderTicketForm account={{ id: "synthetic", kind: "passkey" } as Snapshot["account"]} signIn={() => {}} marketPrice={5} /></QueryClientProvider>;
  const rendered = render(view());
  return () => rendered.rerender(view());
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it("disables review while a changed balance is requoted and retains the entered size", async () => {
  vi.useFakeTimers();
  state.preview.mockResolvedValueOnce({ principal: "5", shortfall: "0" }).mockResolvedValueOnce({ principal: "5", shortfall: "0" }).mockResolvedValue({ principal: "5", shortfall: "4" });
  const rerender = ticket();
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  await advance(700);
  expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
  state.amount = "1";rerender();
  expect(screen.getByRole("button", { name: "Getting quote…" })).toBeDisabled();
  expect(screen.getByLabelText("Size", { exact: true })).toHaveValue("1");
  await advance(700);
  expect(screen.getByRole("button", { name: "Insufficient balance" })).toBeDisabled();
});

it("replaces an old quote error with pending feedback when a fresh balance arrives", async () => {
  vi.useFakeTimers();
  state.preview.mockRejectedValueOnce(new Error("Synthetic unavailable")).mockRejectedValueOnce(new Error("Synthetic unavailable")).mockResolvedValue({ principal: "5", shortfall: "0" });
  const rerender = ticket();
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  await advance(700);
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  state.amount = "20";rerender();
  expect(screen.queryByText("Unable to get a quote. Try again.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Getting quote…" })).toBeDisabled();
  await advance(700);
  expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
});

it("shows an inactive additive DYA fee and blocks review", async () => {
  vi.useFakeTimers();
  state.preview.mockResolvedValue({ principal: "5", shortfall: "0", tradingFee: { dyaBps: 5, providerBps: null, totalBps: null, status: "unverified", message: "DYA fee: 5 bps (0.05%), plus provider fees. Trading is inactive." } });
  ticket();
  fireEvent.change(screen.getByLabelText("Size", { exact: true }), { target: { value: "1" } });
  await advance(700);
  expect(screen.getByText("0.05%")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Fees" })).toBeInTheDocument();
  expect(screen.queryByText(/DYA fee: 5 bps/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Trading unavailable" })).toBeDisabled();
});

it("keeps Review enabled and shows zero when DYA fees are disabled",async()=>{
 vi.useFakeTimers();
 state.preview.mockResolvedValue({principal:"5",shortfall:"0",tradingFee:{dyaBps:0,providerBps:null,totalBps:null,status:"disabled",message:"DYA fees are off. Provider fees still apply."}});
 ticket();fireEvent.change(screen.getByLabelText("Size",{exact:true}),{target:{value:"1"}});await advance(700);
 expect(screen.getByRole("button",{name:"Review"})).toBeEnabled();
 expect(screen.getByText("0%")).toBeInTheDocument();
 expect(screen.queryByText(/Provider fees still apply/)).not.toBeInTheDocument();
});
