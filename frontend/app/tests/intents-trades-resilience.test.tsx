import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { IntentsTrades } from "@/components/near/intents-trades";
import { dataApi } from "@/lib/market-data/hooks";
import type { IntentsTrade } from "@/lib/market-data/api";
const clients: QueryClient[] = [];
const market = "intents:WNEAR_USD";
const trade: IntentsTrade = { time: Date.now(), price: "5.1", quantity: "2", side: "buy", txHash: "HhuKXGFgafJUSvBUq3E1CbKpvBChk6e3gPjvW89W46e5" };
function mount(cached?: IntentsTrade[]) {
  const client = new QueryClient(); clients.push(client);
  client.setQueryData(["near", "catalog"], { assets: [] });
  if (cached) client.setQueryData(["data-api", "intents-trades", market], cached);
  return { client, ...render(<QueryClientProvider client={client}><IntentsTrades marketId={market} base="NEAR" /></QueryClientProvider>) };
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("distinguishes loading from a confirmed empty public-trades response", async () => {
  let finish!: (value: IntentsTrade[]) => void;
  vi.spyOn(dataApi, "intentsTrades").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount();
  expect(screen.getByRole("table", { name: "Market trades" })).toBeInTheDocument();
  expect(screen.queryByText(/No public trades/)).not.toBeInTheDocument();
  await act(async () => finish([]));
  expect(await screen.findByText("No public trades in the last 24 hours.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("shows initial failure, retry progress, then recovered trades", async () => {
  const request = vi.spyOn(dataApi, "intentsTrades").mockRejectedValue(new Error("Offline"));
  mount();
  expect(await screen.findByText("Couldn’t load trades", {}, { timeout: 6000 })).toHaveAttribute("role", "status");
  let finish!: (value: IntentsTrade[]) => void;
  request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  // A fresh query clears the initial error and returns to its loading table.
  await waitFor(() => expect(screen.getByRole("table", { name: "Market trades" })).toHaveAttribute("aria-busy", "true"));
  expect(screen.queryByText(/No public trades/)).not.toBeInTheDocument();
  expect(screen.queryByRole("row", { name: /View public buy/ })).not.toBeInTheDocument();
  await act(async () => finish([trade]));
  expect(await screen.findByText("Buy")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: `Transaction ${trade.txHash}` })).toBeNull();
});
it("retains cached rows during failed refresh and replaces them after retry", async () => {
  const request = vi.spyOn(dataApi, "intentsTrades").mockRejectedValue(new Error("Offline"));
  mount([trade]);
  expect(screen.getByText("Buy")).toBeInTheDocument();
  expect(await screen.findByText("Updates delayed", {}, { timeout: 6000 })).toBeInTheDocument();
  expect(screen.getByText("Buy")).toBeInTheDocument();
  request.mockResolvedValue([{ ...trade, side: "sell" }]);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Sell")).toBeInTheDocument();
  expect(screen.queryByRole("row", { name: /View public buy/ })).not.toBeInTheDocument();
});
it("does not show another market's cached trades after selection changes", async () => {
  const request = vi.spyOn(dataApi, "intentsTrades").mockImplementation(() => new Promise(() => {}));
  const view = mount([trade]);
  view.rerender(<QueryClientProvider client={view.client}><IntentsTrades marketId="intents:BTC_USD" base="BTC" /></QueryClientProvider>);
  await waitFor(() => expect(request).toHaveBeenCalledWith("intents:BTC_USD", expect.any(AbortSignal)));
  expect(screen.queryByRole("row", { name: /View public buy/ })).not.toBeInTheDocument();
  expect(screen.getByText("Size (BTC)")).toBeInTheDocument();
});

it("shows a recoverable unavailable state for unrepresentable trade dates and retries valid HTTP data", async () => {
  const request = vi.fn(async () => Response.json({ market, trades: [{ ...trade, time: 8_640_000_000_000_001 }] }));
  vi.stubGlobal("fetch", request);
  mount();
  expect(await screen.findByText("Couldn’t load trades", {}, { timeout: 6000 })).toHaveAttribute("role", "status");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();expect(screen.queryByText(/Invalid time|RangeError/)).not.toBeInTheDocument();
  request.mockImplementation(async () => Response.json({ market, trades: [trade] }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Buy")).toBeInTheDocument();expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("opens public rows by keyboard with reported USD pricing and resets details when the market changes", async () => {
  vi.spyOn(dataApi, "intentsTrades").mockResolvedValue([trade]);
  const view = mount([trade]);
  fireEvent.keyDown(screen.getByRole("row", { name: "View public buy NEAR trade details" }), { key: "Enter" });
  const dialog = screen.getByRole("dialog", { name: "Public buy · NEAR" });
  expect(dialog).toHaveTextContent("2 NEAR");
  expect(dialog).toHaveTextContent("5.1 USD");
  expect(dialog).toHaveTextContent("$10.20");
  expect(dialog).toHaveTextContent("not necessarily your trade");
  expect(screen.getByRole("link", { name: /view on explorer/ })).toHaveAttribute("href", `https://nearblocks.io/txns/${trade.txHash}`);
  view.rerender(<QueryClientProvider client={view.client}><IntentsTrades marketId="different" base="BTC" /></QueryClientProvider>);
  expect(screen.queryByRole("dialog")).toBeNull();
});
