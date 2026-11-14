import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMarketTicker } from "@/lib/market-data/hooks";
import type { Ticker } from "@/lib/market-data/api";
import type { StreamListener, StreamStatus, StreamSubscription } from "@/lib/market-data/stream";

const stream = vi.hoisted(() => ({ status: "open" as StreamStatus, listeners: new Map<string, StreamListener>(), statusListeners: new Set<(status: StreamStatus) => void>() }));
vi.mock("@/lib/market-data/stream", () => ({ MarketStream: class {
  getStatus() { return stream.status; }
  onStatus(listener: (status: StreamStatus) => void) { stream.statusListeners.add(listener);return () => stream.statusListeners.delete(listener); }
  subscribe(subscription: StreamSubscription, listener: StreamListener) { stream.listeners.set(subscription.market, listener);return () => stream.listeners.delete(subscription.market); }
} }));
const now = Date.UTC(2026, 9, 17, 0);
const market = "binance:NEARUSDC";
const ticker = (price: string, time = now): Ticker => ({ symbol: "NEARUSDC", lastPrice: price, openPrice: "9", highPrice: "15", lowPrice: "8", volume: "10", quoteVolume: "100", changePercent: 1, eventTime: time });
const clients: QueryClient[] = [];
afterEach(() => { cleanup();clients.splice(0).forEach(client => client.clear());vi.useRealTimers();vi.unstubAllGlobals();stream.listeners.clear();stream.statusListeners.clear();stream.status = "open"; });
function setup() {
  vi.useFakeTimers();vi.setSystemTime(now);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic REST unavailable")));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  client.setQueryData(["data-api", "ticker", market], { ticker: ticker("9", now - 1000), receivedAt: now });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(({ id }) => useMarketTicker(id), { initialProps: { id: market }, wrapper });
  return { client, hook };
}
async function seed(client: QueryClient, value: Ticker, receivedAt = Date.now()) {
  await act(async () => { client.setQueryData(["data-api", "ticker", market], { ticker: value, receivedAt });await vi.advanceTimersByTimeAsync(1); });
}
function push(value: Ticker) { act(() => { stream.listeners.get(market)!.ticker!(value, false); }); }

it("uses a newer REST ticker after an older stream snapshot", async () => {
  const { client, hook } = setup();push(ticker("10"));
  await seed(client, ticker("12", now + 1000));
  expect(hook.result.current.ticker?.lastPrice).toBe("12");
  expect(hook.result.current.live).toBe(true);
});
it("does not replace a newer stream price with an older REST ticker", async () => {
  const { client, hook } = setup();push(ticker("12", now + 1000));
  await seed(client, ticker("10", now));
  expect(hook.result.current.ticker?.lastPrice).toBe("12");
});
it("expires a silent stream snapshot even while the socket remains open", async () => {
  const { hook } = setup();push(ticker("10"));
  await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });
  expect(hook.result.current.ticker?.lastPrice).toBe("10");
  expect(hook.result.current.live).toBe(false);
});
it("does not borrow REST freshness to mark a disconnected older stream selection live", async () => {
  const { client, hook } = setup();push(ticker("12", now + 1000));
  act(() => { stream.status = "reconnecting";stream.statusListeners.forEach(listener => listener(stream.status)); });
  await seed(client, ticker("10", now));
  expect(hook.result.current.ticker?.lastPrice).toBe("12");
  expect(hook.result.current.live).toBe(false);
});
it("refetches the REST ticker when stream recovery requests resynchronization", async () => {
  const { hook } = setup();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ tickers: [{ market, ...ticker("12", now + 1000) }] }));
  await act(async () => { stream.listeners.get(market)!.resync?.();await vi.advanceTimersByTimeAsync(1); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(hook.result.current.ticker?.lastPrice).toBe("12");
});
it("never shows a departed market's ticker while its replacement is loading", () => {
  const { hook } = setup();push(ticker("10"));
  hook.rerender({ id: "binance:BTCUSDC" });
  expect(stream.listeners.has(market)).toBe(false);
  expect(hook.result.current.ticker).toBeUndefined();
  expect(hook.result.current.live).toBe(false);
  expect(hook.result.current.isPending).toBe(true);
});

it("does not roll a stream price backward when a later delivery carries an older venue event", () => {
  const { hook } = setup();
  push(ticker("12", now + 1000));push(ticker("10", now));
  expect(hook.result.current.ticker?.lastPrice).toBe("12");
});

it("accepts a correction with the same venue event timestamp", () => {
  const { hook } = setup();
  push(ticker("12", now + 1000));push(ticker("12.5", now + 1000));
  expect(hook.result.current.ticker?.lastPrice).toBe("12.5");
});
