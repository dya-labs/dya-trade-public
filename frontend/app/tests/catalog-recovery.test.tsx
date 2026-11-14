import { withTokenPolicy } from "./fixtures/token-policy";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { getCatalog } from "@dya/wallet-ui/lib/near/http/catalog-client";
import { getTokenMarkets } from "@/lib/near/http/catalog-client";
import { AssetSelector } from "@/components/near/asset-selector";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { RateLimitError } from "@dya/wallet-ui/lib/near/domain/rate-limit";
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: vi.fn() }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: vi.fn() }));
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => null }));
let client: QueryClient;
const assets = [DEFAULT_PAIR.base, DEFAULT_PAIR.quote, { ...DEFAULT_PAIR.base, assetId: "synthetic-btc", symbol: "BTC" }];
function CatalogPicker() {
  const catalog = useCatalogQuery();
  const [asset, select] = useState(DEFAULT_PAIR.base);
  return <AssetSelector label="base asset" asset={asset} assets={catalog.data?.assets ?? []} excludedId={DEFAULT_PAIR.quote.assetId} catalogUnavailable={catalog.isError} retryCatalog={() => void catalog.refetch()} catalogRetrying={catalog.isFetching} onSelect={select} />;
}
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><CatalogPicker /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTokenMarkets).mockResolvedValue({ updatedAt: Date.now(), assets: {} });
});
afterEach(() => { cleanup(); client.clear(); });
it("recovers an empty catalog through the picker with pending retry feedback and no premature choices", async () => {
  vi.mocked(getCatalog).mockRejectedValueOnce(new Error("Synthetic unavailable"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  expect(await screen.findByText("Markets temporarily unavailable.")).toBeVisible();
  expect(screen.queryByText("No matching tokens.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Select BTC" })).toBeNull();
  let resolve!: (value: Awaited<ReturnType<typeof getCatalog>>) => void;
  vi.mocked(getCatalog).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Loading…" })).toBeDisabled();
  expect(screen.queryByText("No matching tokens.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Select BTC" })).toBeNull();
  await act(async () => resolve(withTokenPolicy({ assets })));
  expect(await screen.findByRole("button", { name: "Select BTC" })).toBeEnabled();
  expect(screen.queryByText(/Markets temporarily unavailable/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Select USDC" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select BTC" }));
  expect(screen.getByRole("button", { name: "Select market: BTC" })).toBeVisible();
  expect(getCatalog).toHaveBeenCalledTimes(2);
});
it("preserves cached choices and search during failed refresh and replaces the list after recovery", async () => {
  vi.mocked(getCatalog).mockResolvedValueOnce(withTokenPolicy({ assets }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  await screen.findByRole("button", { name: "Select BTC" });
  fireEvent.change(screen.getByRole("textbox", { name: "Search tokens" }), { target: { value: "btc" } });
  vi.mocked(getCatalog).mockRejectedValueOnce(new Error("Synthetic refresh failure"));
  await act(async () => { await client.invalidateQueries({ queryKey: ["near", "catalog"] }); });
  expect(await screen.findByText("Markets temporarily unavailable. Showing the last available list.")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Search tokens" })).toHaveValue("btc");
  expect(screen.getByRole("button", { name: "Select BTC" })).toBeEnabled();
  vi.mocked(getCatalog).mockResolvedValueOnce(withTokenPolicy({ assets: assets.slice(0, 2) }));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Select BTC" })).toBeNull());
  expect(screen.getByRole("textbox", { name: "Search tokens" })).toHaveValue("btc");
  expect(screen.getByText("No matching tokens.")).toBeVisible();
  expect(screen.queryByText(/Markets temporarily unavailable/)).toBeNull();
});
it("honors a catalog rate-limit cooldown across manual retries then recovers after its deadline", async () => {
  const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    vi.mocked(getCatalog).mockRejectedValueOnce(new RateLimitError(now + 60000));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
    await screen.findByText("Markets temporarily unavailable.");
    await act(async () => { await client.refetchQueries({ queryKey: ["near", "catalog"] }); });
    expect(getCatalog).toHaveBeenCalledOnce();
    clock.mockReturnValue(now + 60001);
    vi.mocked(getCatalog).mockResolvedValueOnce(withTokenPolicy({ assets }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Select BTC" })).toBeEnabled();
    expect(getCatalog).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); }
});
