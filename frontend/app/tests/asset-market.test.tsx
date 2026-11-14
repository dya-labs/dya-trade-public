// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useAssetMarket, useDataDegraded } from "@/lib/market-data/hooks";

const market = (id: string, venue: string, sourceLabel: string, quote: string) => ({ id, venue, sourceLabel, symbol: id.split(":")[1], base: "SOL", quote, assetId: "sol", firstOpenTime: 0, intervals: ["1m"] });
const binance = market("binance:SOLUSDC", "binance", "Binance", "USDC");
const intents = market("intents:SOL_USD", "intents", "NEAR Intents", "USD");

function render(listed: ReturnType<typeof market>[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => new URL(input).pathname === "/v1/assets"
    ? Response.json({ assets: [{ assetId: "sol", symbol: "SOL", primaryMarket: listed[0]?.id ?? null, alternatives: listed.slice(1).map(item => item.id), sourceLabel: listed[0]?.sourceLabel ?? null, unavailableReason: null, sources: [] }] })
    : Response.json({ markets: listed })));
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useAssetMarket("sol"), { wrapper });
}

afterEach(() => vi.unstubAllGlobals());

it("charts the exchange as the reference and overlays the asset's NEAR Intents market", async () => {
  const view = render([binance, intents]);
  await waitFor(() => expect(view.result.current.market).toEqual({ id: "binance:SOLUSDC", assetId: "sol", venue: "binance", base: "SOL", quote: "USDC", sourceLabel: "Binance", firstOpenTime: 0 }));
  expect(view.result.current.intentsMarket).toMatchObject({ id: "intents:SOL_USD", quote: "USD" });
});

it("never charts NEAR Intents as the reference", async () => {
  const noIntents = render([binance]);
  await waitFor(() => expect(noIntents.result.current.market?.id).toBe("binance:SOLUSDC"));
  expect(noIntents.result.current.intentsMarket).toBeNull();
  const onlyIntents = render([intents]);
  await waitFor(() => expect(onlyIntents.result.current.intentsMarket?.id).toBe("intents:SOL_USD"));
  expect(onlyIntents.result.current.market).toBeNull();
});

it.each([binance, intents])("rejects $venue market ownership by another asset instead of relabelling it", async listed => {
  const view = render([{ ...listed, assetId: "synthetic-other-asset" }]);
  await waitFor(() => expect(view.result.current.market).not.toBeUndefined());
  expect(view.result.current.market).toBeNull();
  expect(view.result.current.intentsMarket).toBeNull();
});

it("keeps a matching alternative when the advertised primary belongs to another asset", async () => {
  const view = render([{ ...binance, assetId: "synthetic-other-asset" }, intents]);
  await waitFor(() => expect(view.result.current.market).not.toBeUndefined());
  expect(view.result.current.market).toBeNull();
  expect(view.result.current.intentsMarket?.id).toBe(intents.id);
});

it.each([
  ["reported", { cause: "near-intents", since: 1_793_000_000_000 }, { cause: "near-intents", since: 1_793_000_000_000 }],
  ["healthy", null, null],
  ["omitted by older deployments", undefined, null],
])("reads degradation %s from the shared markets request while the chart market still resolves", async (_, degraded, expected) => {
  const fetcher = vi.fn(async (input: string) => new URL(input).pathname === "/v1/assets"
    ? Response.json({ assets: [{ assetId: "sol", symbol: "SOL", primaryMarket: binance.id, alternatives: [], sourceLabel: "Binance", unavailableReason: null, sources: [] }] })
    : Response.json(degraded === undefined ? { markets: [binance] } : { markets: [binance], degraded }));
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => ({ asset: useAssetMarket("sol"), degraded: useDataDegraded() }), { wrapper });
  await waitFor(() => expect(view.result.current.asset.market?.id).toBe("binance:SOLUSDC"));
  expect(view.result.current.degraded).toEqual(expected);
  expect(fetcher.mock.calls.filter(([input]) => new URL(input).pathname === "/v1/markets")).toHaveLength(1);
});
