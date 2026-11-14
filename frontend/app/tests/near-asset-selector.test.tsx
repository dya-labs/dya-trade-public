import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getTokenMarkets } from "@/lib/near/http/catalog-client";
import { AssetSelector } from "@/components/near/asset-selector";
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => <span /> }));
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenMarkets: vi.fn(async () => ({ updatedAt: 1, assets: { a: { price: 2, volume24h: 10, marketCap: 20 }, b: { price: 1, volume24h: 100, marketCap: 30 } } })) }));
it("sorts, searches and selects tokens in the data table", async () => {
  const assets = ["AAA", "BBB", "MISSING"].map((symbol, i) => ({ assetId: ["a", "b", "missing"][i], symbol, decimals: 6, blockchain: "near" }));
  const onSelect = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetSelector label="token" asset={assets[0]} assets={assets} excludedId="usdc" onSelect={onSelect} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  await screen.findByText(/\$100/);
  const table = screen.getByRole("table");
  expect(within(table).getByText("MISSING")).toBeInTheDocument();
  const missing = within(table).getByText("MISSING").closest("tr")!;
  expect(within(missing).getAllByText("-")).toHaveLength(4);
  expect(within(table).getAllByRole("row")[1].textContent).toContain("BBB");
  fireEvent.click(screen.getByRole("button", { name: "Sort by 24h volume" }));
  expect(within(table).getAllByRole("row")[1].textContent).toContain("AAA");
  fireEvent.change(screen.getByRole("textbox", { name: "Search tokens" }), { target: { value: "BBB" } });
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Select BBB" }));
  expect(onSelect).toHaveBeenCalledWith(assets[1]);
});

it("keeps supported tokens selectable when market metadata fails", async () => {
  vi.mocked(getTokenMarkets).mockRejectedValueOnce(new Error("unavailable"));
  const asset = { assetId: "a", symbol: "AAA", decimals: 6, blockchain: "near" };
  const onSelect = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetSelector label="token" asset={asset} assets={[asset]} excludedId="usdc" onSelect={onSelect} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  await screen.findByText("Market data unavailable. You can still select a token.");
  fireEvent.click(screen.getByRole("button", { name: "Select AAA" }));
  expect(onSelect).toHaveBeenCalledWith(asset);
});

it("places catalog recovery inside the selector and retains cached tokens", async () => {
  const asset = { assetId: "a", symbol: "AAA", decimals: 6, blockchain: "near" };
  const retry = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><AssetSelector label="token" asset={asset} assets={[asset]} excludedId="usdc" onSelect={vi.fn()} catalogUnavailable retryCatalog={retry} /></QueryClientProvider>);
  expect(screen.queryByText(/Markets temporarily unavailable/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  expect(await screen.findByText(/Showing the last available list/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Select AAA" })).toBeEnabled();
});

it("excludes the quote token and resets an unmatched search when reopened", async () => {
  const assets = ["AAA", "BBB", "USDC"].map((symbol, i) => ({ assetId: ["a", "b", "usdc"][i], symbol, decimals: 6, blockchain: "near" }));
  const selected = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetSelector label="token" asset={assets[0]} assets={assets} excludedId="usdc" onSelect={selected} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  await screen.findByText(/\$100/);
  expect(screen.queryByRole("button", { name: "Select USDC" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search tokens" }), { target: { value: "not-listed" } });
  expect(screen.getByText("No matching tokens.")).toBeInTheDocument();
  expect(selected).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  expect(screen.getByRole("textbox", { name: "Search tokens" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "Select BBB" })).toBeInTheDocument();
});

it("keeps missing market values last in both sort directions", async () => {
  const assets = ["AAA", "BBB", "MISSING"].map((symbol, i) => ({ assetId: ["a", "b", "missing"][i], symbol, decimals: 6, blockchain: "near" }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetSelector label="token" asset={assets[0]} assets={assets} excludedId="usdc" onSelect={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  await screen.findByText(/\$100/);
  const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map(row => row.textContent);
  expect(rows().at(-1)).toContain("MISSING");
  fireEvent.click(screen.getByRole("button", { name: "Sort by 24h volume" }));
  expect(rows()[0]).toContain("AAA");
  expect(rows().at(-1)).toContain("MISSING");
  fireEvent.click(screen.getByRole("button", { name: "Sort by 24h volume" }));
  expect(rows()[0]).toContain("BBB");
  expect(rows().at(-1)).toContain("MISSING");
});

it("searches display and underlying token symbols case-insensitively with whitespace", async () => {
  const asset = { assetId: "nep141:wrap.near", symbol: "WNEAR", decimals: 24, blockchain: "near" };
  const selected = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetSelector label="token" asset={asset} assets={[asset]} excludedId="usdc" onSelect={selected} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search tokens" }), { target: { value: "  wNeAr  " } });
  expect(screen.getByRole("button", { name: "Select NEAR" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search tokens" }), { target: { value: " near " } });
  fireEvent.click(screen.getByRole("button", { name: "Select NEAR" }));
  expect(selected).toHaveBeenCalledExactlyOnceWith(asset);
});

it.each([
  ["Price", "price", ["BBB", "CCC", "AAA"]],
  ["24h change", "change24h", ["AAA", "BBB", "CCC"]],
  ["24h volume", "volume24h", ["CCC", "AAA", "BBB"]],
  ["Market cap", "marketCap", ["BBB", "AAA", "CCC"]],
] as const)("sorts %s in both directions with missing values last and an accessible direction", async (label, _key, ascending) => {
  const assets = ["AAA", "BBB", "CCC", "MISSING"].map(symbol => ({ assetId: symbol, symbol, decimals: 18, blockchain: "near" }));
  vi.mocked(getTokenMarkets).mockResolvedValueOnce({ updatedAt: Date.now(), assets: {
    AAA: { image: null, price: 2e-18, change24h: -10, volume24h: 1e20, marketCap: 100 },
    BBB: { image: null, price: 1e-18, change24h: 0, volume24h: 2e20, marketCap: 0 },
    CCC: { image: null, price: 1.5e-18, change24h: 5, volume24h: 0, marketCap: 200 },
  } });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetSelector label="token" asset={assets[0]} assets={assets} excludedId="usdc" onSelect={vi.fn()} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
  await screen.findByText("$200");
  const control = screen.getByRole("button", { name: `Sort by ${label}` });
  const header = control.closest("th")!;
  const order = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map(row => within(row).getByRole("button").getAttribute("aria-label")!.replace("Select ", ""));
  // Market cap starts descending; another numeric column starts unsorted.
  if (header.getAttribute("aria-sort") === "none") fireEvent.click(control);
  expect(header).toHaveAttribute("aria-sort", "descending");
  expect(order()).toEqual([...[...ascending].reverse(), "MISSING"]);
  fireEvent.click(control);
  expect(header).toHaveAttribute("aria-sort", "ascending");
  expect(order()).toEqual([...ascending, "MISSING"]);
});


it("shows token, price and sortable volume on mobile with 24h change beneath price", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("639px"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  try {
    const asset = { assetId: "a", symbol: "AAA", decimals: 6, blockchain: "near" };
    vi.mocked(getTokenMarkets).mockResolvedValueOnce({ updatedAt: Date.now(), assets: { a: { image: null, price: 2, change24h: 1.25, volume24h: 10, marketCap: 20 } } });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AssetSelector label="token" asset={asset} assets={[asset]} excludedId="usdc" onSelect={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Select market/ }));
    await screen.findByText("$2");
    const change = screen.getByText("+1.25%", { selector: ":not([aria-hidden] *)" });
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(3);
    expect(change.closest("td")).toHaveTextContent("$2");
    expect(screen.getByRole("button", { name: "Sort by 24h volume" })).toBeEnabled();
    expect(screen.getByText("$10")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sort by Market cap" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select AAA" })).toBeEnabled();
  } finally { vi.unstubAllGlobals(); }
});
