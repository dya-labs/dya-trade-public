import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useOrderTicket } from "@/components/near/use-order-ticket";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { prepareMarketOrder } from "@/lib/near/http/trading-client";
import { startAuthentication } from "@dya/wallet-sdk";
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn() }));
const balance = vi.hoisted(() => ({ amount: "100" }));
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getAllBalances: async () => ({ assets: [{ ...DEFAULT_PAIR.quote, amount: balance.amount, raw: "100000000" }] }) }));
vi.mock("@/lib/near/http/trading-client", () => ({ abandonLimitOrder: vi.fn(), prepareLimitOrder: vi.fn(), previewLimitOrder: vi.fn(), previewMarketOrder: vi.fn(), prepareMarketOrder: vi.fn(), submitLimitOrder: vi.fn(), submitMarketOrder: vi.fn(), getMarketTradeStatus: vi.fn() }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.resetAllMocks(); balance.amount = "100"; localStorage.removeItem("dya:trade-size-unit:v1"); localStorage.removeItem("dya:market-slippage:v1"); });
function setup(price: number | null = 5) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return renderHook(({ price }) => useOrderTicket({ id: "account", kind: "passkey" }, price, DEFAULT_PAIR, price), { initialProps: { price }, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
it("converts quote amount to base quantity and preserves the order when switching units", () => {
  const h = setup();
  act(() => h.result.current.changeSizeUnit("quote"));
  act(() => h.result.current.editSize("10"));
  expect(h.result.current.quoteAmount).toBe("10");
  expect(h.result.current.quantity).toBe("2");
  act(() => h.result.current.changeSizeUnit("base"));
  expect(h.result.current.quantity).toBe("2");
});
it("allows exact-spend buys without a reference and rejects incomplete or overprecision amounts", () => {
  const missing = setup(null);
  act(() => missing.result.current.changeSizeUnit("quote"));
  expect(missing.result.current.sizeUnit).toBe("quote");
  const h = setup();
  act(() => h.result.current.changeSizeUnit("quote"));
  for (const value of ["1.", "0.0000001", "-1", "1e3"]) {
    act(() => h.result.current.editSize(value));
    expect(h.result.current.validQuantity).toBe(false);
  }
});
it("recalculates quote-denominated limit sizes using the entered limit price", () => {
  const h = setup();
  act(() => h.result.current.setOrderType("limit"));
  act(() => h.result.current.editPrice("5"));
  act(() => h.result.current.changeSizeUnit("quote"));
  act(() => h.result.current.editSize("10"));
  expect(h.result.current.quantity).toBe("2");
  act(() => h.result.current.editPrice("4"));
  expect(h.result.current.quantity).toBe("2.5");
  act(() => h.result.current.editPrice("."));
  expect(h.result.current.validQuantity).toBe(false);
});
it("blocks an executable buy quote that exceeds the entered quote budget", async () => {
  const h = setup();
  await waitFor(() => expect(h.result.current.asset).toBeDefined());
  act(() => h.result.current.changeSizeUnit("quote"));
  act(() => h.result.current.editSize("10"));
  vi.mocked(prepareMarketOrder).mockResolvedValue({ review: { principal: "10.01" }, options: {} } as never);
  await act(async () => h.result.current.openReview());
  expect(startAuthentication).not.toHaveBeenCalled();
  expect(h.result.current.sizeError).toMatch(/exceeds the entered USDC budget/);
  expect(h.result.current.error).toBe("");
});

it("fills USDC sizes from the slider to whole cents, never above the two-decimal balance", async () => {
  balance.amount = "9.998155";
  const h = setup();
  await waitFor(() => expect(h.result.current.asset).toBeDefined());
  act(() => h.result.current.changeSizeUnit("quote"));
  act(() => h.result.current.updateSizePercent(100));
  expect(h.result.current.quoteAmount).toBe("9.99");
  act(() => h.result.current.updateSizePercent(50));
  expect(h.result.current.quoteAmount).toBe("4.99");
  // A typed amount keeps its full precision.
  act(() => h.result.current.editSize("9.998155"));
  expect(h.result.current.quoteAmount).toBe("9.998155");
});

it("remembers only the unit across ticket remounts and starts with an empty amount", () => {
 const first = setup();
 act(() => first.result.current.changeSizeUnit("quote"));
 act(() => first.result.current.editSize("10"));
 expect(localStorage.getItem("dya:trade-size-unit:v1")).toBe('"quote"');
 first.unmount();
 const restored = setup();
 expect(restored.result.current.sizeUnit).toBe("quote");
 expect(restored.result.current.quoteAmount).toBe("");
 expect(restored.result.current.quantity).toBe("");
 act(() => restored.result.current.changeSizeUnit("base"));
 expect(localStorage.getItem("dya:trade-size-unit:v1")).toBe('"base"');
});
it("ignores invalid stored units and keeps unavailable quote sizing safe", () => {
 localStorage.setItem("dya:trade-size-unit:v1", '"ETH"');
 const invalid = setup();
 expect(invalid.result.current.sizeUnit).toBe("base");
 invalid.unmount();
 localStorage.setItem("dya:trade-size-unit:v1", '"quote"');
 const missingPrice = setup(null);
 expect(missingPrice.result.current.sizeUnit).toBe("quote");
 act(() => missingPrice.result.current.editSize("10"));
 expect(missingPrice.result.current.validQuantity).toBe(true);
});

it("remembers custom slippage and passes it to executable preparation", async () => {
  const h = setup();
  await waitFor(() => expect(h.result.current.asset).toBeDefined());
  act(() => h.result.current.changeSlippage({ mode: "custom", bps: 25 }));
  act(() => h.result.current.editSize("1"));
  vi.mocked(prepareMarketOrder).mockRejectedValue(new Error("stop before approval"));
  await act(async () => h.result.current.openReview());
  expect(prepareMarketOrder).toHaveBeenCalledWith(expect.objectContaining({ slippage: { mode: "custom", bps: 25 } }));
  h.unmount();
  expect(setup().result.current.slippage).toEqual({ mode: "custom", bps: 25 });
});

it("migrates the legacy Auto preference to the fixed default", () => {
  localStorage.setItem("dya:market-slippage:v1", JSON.stringify({ mode: "auto" }));
  expect(setup().result.current.slippage).toEqual({ mode: "default" });
});

it("prefills Limit once, preserves edits on ticks, and Last explicitly refreshes", () => {
  const h = setup(5);
  act(() => h.result.current.setOrderType("limit"));
  expect(h.result.current.price).toBe("5");
  act(() => h.result.current.editPrice("4.5"));
  h.rerender({ price: 6 });
  expect(h.result.current.price).toBe("4.5");
  act(() => h.result.current.setOrderType("market"));
  act(() => h.result.current.setOrderType("limit"));
  expect(h.result.current.price).toBe("4.5");
  act(() => h.result.current.applyLastPrice());
  expect(h.result.current.price).toBe("6");
});
it("leaves limit price empty without a valid last price", () => {
  const h = setup(null);
  act(() => h.result.current.setOrderType("limit"));
  expect(h.result.current.price).toBe("");
  expect(h.result.current.lastPriceAvailable).toBe(false);
  act(() => h.result.current.applyLastPrice());
  expect(h.result.current.price).toBe("");
});

it("does not use the exchange sizing price as Last when Intents has no valid price", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const h = renderHook(() => useOrderTicket({ id: "account", kind: "passkey" }, 2400, DEFAULT_PAIR, null), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  act(() => h.result.current.setOrderType("limit"));
  expect(h.result.current.price).toBe("");
  expect(h.result.current.lastPriceAvailable).toBe(false);
});

it.each([[2392.123456789, "2392.12"], [0.0000123456789, "0.0000123457"]])("uses the central price preset for Last %s and preserves manual precision", (last, expected) => {
  const h = setup(last);
  act(() => h.result.current.setOrderType("limit"));
  expect(h.result.current.price).toBe(expected);
  act(() => h.result.current.editPrice("2392.123456789"));
  expect(h.result.current.price).toBe("2392.123456789");
  expect(h.result.current.validLimitPrice).toBe(true);
  act(() => h.result.current.applyLastPrice());
  expect(h.result.current.price).toBe(expected);
});

 it("passes the exact USDC spend to market preparation without a reference price", async () => {
  const h = setup(null);
  await waitFor(() => expect(h.result.current.asset).toBeDefined());
  act(() => h.result.current.changeSizeUnit("quote"));
  act(() => h.result.current.editSize("10"));
  vi.mocked(prepareMarketOrder).mockRejectedValue(new Error("stop before approval"));
  await act(async () => h.result.current.openReview());
  expect(prepareMarketOrder).toHaveBeenLastCalledWith(expect.objectContaining({ side: "buy", quoteAmount: "10" }));
 });
