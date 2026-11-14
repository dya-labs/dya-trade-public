import { expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TokenProjectLinks } from "@/components/near/token-project-links";
import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
vi.mock("@/lib/near/http/catalog-client", () => ({ getTokenLinks: vi.fn() }));
it("links to the canonical project's website and X in new tabs", () => {
  const client = new QueryClient();
  client.setQueryData(["near", "token-links"], { assets: { [DEFAULT_PAIR.base.assetId]: { website: "https://near.org/", x: "https://x.com/NEARProtocol" } } });
  const view = render(<QueryClientProvider client={client}><TokenProjectLinks asset={DEFAULT_PAIR.base} /></QueryClientProvider>);
  expect(screen.getByRole("link", { name: "NEAR website" })).toHaveAttribute("href", "https://near.org/");
  expect(screen.getByRole("link", { name: "NEAR on X" })).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("link", { name: "NEAR on X" })).toHaveAttribute("rel", "noopener noreferrer");
  view.rerender(<QueryClientProvider client={client}><TokenProjectLinks asset={{ ...DEFAULT_PAIR.base, assetId: "missing" }} /></QueryClientProvider>);
  expect(screen.queryByRole("link")).toBeNull();
  cleanup();
});
it("hides either link independently when missing", () => {
  const client = new QueryClient();
  client.setQueryData(["near", "token-links"], { assets: { [DEFAULT_PAIR.base.assetId]: { website: "https://near.org/", x: null } } });
  render(<QueryClientProvider client={client}><TokenProjectLinks asset={DEFAULT_PAIR.base} /></QueryClientProvider>);
  expect(screen.getByRole("link", { name: "NEAR website" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "NEAR on X" })).toBeNull();
  cleanup();
});
