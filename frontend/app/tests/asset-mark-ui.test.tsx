import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssetMark } from "@dya/wallet-ui/components/near/asset-mark";
import { NetworkMark } from "@dya/wallet-ui/components/near/network-mark";
import { getNetworkIcons, getTokenIcons } from "@dya/wallet-ui/lib/near/http/catalog-client";
import { bundledTokenIcon } from "@dya/wallet-ui/lib/bundled-token-icons";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";

vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getTokenIcons: vi.fn(), getNetworkIcons: vi.fn() }));
const unknown = { ...DEFAULT_PAIR.base, assetId: "synthetic:unknown", symbol: "NEAR", coingeckoId: undefined };
const clients: QueryClient[] = [];
function view(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });clients.push(client);
  return { client, ...render(<QueryClientProvider client={client}>{children}</QueryClientProvider>) };
}
afterEach(() => { cleanup();clients.splice(0).forEach(client => client.clear());vi.resetAllMocks(); });
const src = (container: HTMLElement) => container.querySelector("img")?.getAttribute("src");

it("uses the exact wrapped-NEAR identity without requesting remote token metadata", () => {
  const result = view(<AssetMark asset={{ ...DEFAULT_PAIR.base, coingeckoId: undefined }} />);
  expect(src(result.container) === bundledTokenIcon("near")).toBe(true);
  expect(getTokenIcons).not.toHaveBeenCalled();
});
it("never assigns the bundled NEAR icon to an unrelated asset sharing its symbol", async () => {
  vi.mocked(getTokenIcons).mockResolvedValue({ icons: {} });
  const result = view(<AssetMark asset={unknown} />);
  await waitFor(() => expect(getTokenIcons).toHaveBeenCalledOnce());
  expect(result.container.querySelector("img")).toBeNull();
  expect(result.container.querySelector("svg")).not.toBeNull();
});
it("chooses different verified identities independently of their shared symbol", () => {
  const result = view(<><AssetMark asset={{ ...unknown, assetId: "synthetic:btc", coingeckoId: "bitcoin" }} /><AssetMark asset={{ ...unknown, assetId: "synthetic:eth", coingeckoId: "ethereum" }} /></>);
  const images = [...result.container.querySelectorAll("img")];
  expect(images[0].getAttribute("src") === bundledTokenIcon("bitcoin")).toBe(true);
  expect(images[1].getAttribute("src") === bundledTokenIcon("ethereum")).toBe(true);
  expect(getTokenIcons).not.toHaveBeenCalled();
});
it("resolves same-symbol remote icons by exact asset ID and shares one metadata request", async () => {
  vi.mocked(getTokenIcons).mockResolvedValue({ icons: { "synthetic:a": "https://icons.example.test/a.png", "synthetic:b": "https://icons.example.test/b.png" } });
  const result = view(<><AssetMark asset={{ ...unknown, assetId: "synthetic:a" }} /><AssetMark asset={{ ...unknown, assetId: "synthetic:b" }} /></>);
  await waitFor(() => expect(result.container.querySelectorAll("img")).toHaveLength(2));
  expect([...result.container.querySelectorAll("img")].map(image => image.getAttribute("src"))).toEqual(["https://icons.example.test/a.png", "https://icons.example.test/b.png"]);
  expect(getTokenIcons).toHaveBeenCalledOnce();
});
it("keeps a generic mark when remote icon metadata fails", async () => {
  vi.mocked(getTokenIcons).mockRejectedValue(new Error("Synthetic unavailable"));
  const result = view(<AssetMark asset={unknown} />);
  await waitFor(() => expect(result.client.getQueryState(["near", "token-icons"])?.status).toBe("error"));
  expect(result.container.querySelector("img")).toBeNull();
  expect(result.container.querySelector("svg")).not.toBeNull();
});
it("falls back after a token image error and accepts a replacement URL", async () => {
  vi.mocked(getTokenIcons).mockResolvedValue({ icons: { [unknown.assetId]: "https://icons.example.test/old.png" } });
  const result = view(<AssetMark asset={unknown} />);
  await waitFor(() => expect(src(result.container)).toBe("https://icons.example.test/old.png"));
  fireEvent.error(result.container.querySelector("img")!);expect(result.container.querySelector("img")).toBeNull();
  act(() => { result.client.setQueryData(["near", "token-icons"], { icons: { [unknown.assetId]: "https://icons.example.test/new.png" } }); });
  await waitFor(() => expect(src(result.container)).toBe("https://icons.example.test/new.png"));
});
it("keeps an unknown network generic instead of borrowing another network icon", async () => {
  vi.mocked(getNetworkIcons).mockResolvedValue({ icons: { base: "https://icons.example.test/base.png" } });
  const result = view(<NetworkMark network="unknown-network" />);
  await waitFor(() => expect(getNetworkIcons).toHaveBeenCalledOnce());
  expect(result.container.querySelector("img")).toBeNull();
});
it("falls back after a network image error and accepts replacement metadata", async () => {
  vi.mocked(getNetworkIcons).mockResolvedValue({ icons: { base: "https://icons.example.test/old-base.png" } });
  const result = view(<NetworkMark network="base" />);
  await waitFor(() => expect(src(result.container)).toBe("https://icons.example.test/old-base.png"));
  fireEvent.error(result.container.querySelector("img")!);expect(result.container.querySelector("img")).toBeNull();
  act(() => { result.client.setQueryData(["near", "network-icons", 2], { icons: { base: "https://icons.example.test/new-base.png" } }); });
  await waitFor(() => expect(src(result.container)).toBe("https://icons.example.test/new-base.png"));
});
it("uses the grouped-network count instead of a misleading single-network badge", () => {
  const result = view(<AssetMark asset={DEFAULT_PAIR.base} network="base" networkCount={3} />);
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(result.container.querySelectorAll("img")).toHaveLength(1);
  expect(getNetworkIcons).not.toHaveBeenCalled();
});
it("keeps token and network images decorative for their labeled parent controls", async () => {
  vi.mocked(getNetworkIcons).mockResolvedValue({ icons: { base: "https://icons.example.test/base.png" } });
  const result = view(<AssetMark asset={DEFAULT_PAIR.base} network="base" />);
  await waitFor(() => expect(result.container.querySelectorAll("img")).toHaveLength(2));
  expect([...result.container.querySelectorAll("img")].every(image => image.alt === "")).toBe(true);
  expect(screen.queryAllByRole("img")).toHaveLength(0);
  expect(result.container.firstElementChild).toHaveAttribute("aria-hidden", "true");
});
