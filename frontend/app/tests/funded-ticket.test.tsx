import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { DEFAULT_PAIR, type SelectedPair } from "@/lib/near/domain/catalog";
import { OrderTicket } from "@/components/near/funded-ticket";
vi.mock("@/components/near/ticket", () => ({ OrderTicketForm: ({ pair }: { pair: SelectedPair }) => <div data-testid="funding-asset">{pair.quote.assetId}</div> }));
vi.mock("@dya/ui/components/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => <select aria-label="Funding balance" value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
vi.mock("@dya/wallet-ui/lib/near/http/catalog-client", () => ({ getCatalog: async () => ({ assets: [
  { ...DEFAULT_PAIR.quote, coingeckoId: "usd-coin" },
  { ...DEFAULT_PAIR.quote, assetId: "nep141:base-usdc", blockchain: "base", coingeckoId: "usd-coin" },
  { ...DEFAULT_PAIR.quote, assetId: "nep141:fake-usdc", blockchain: "base", coingeckoId: "fake" },
] }) }));
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getAllBalances: async () => ({ assets: [
  { ...DEFAULT_PAIR.quote, raw: "0", amount: "0" },
  { ...DEFAULT_PAIR.quote, assetId: "nep141:base-usdc", raw: "10000000", amount: "10" },
  { ...DEFAULT_PAIR.quote, assetId: "nep141:fake-usdc", raw: "10000000", amount: "10" },
] }) }));
it("uses only NEAR USDC for trading even when other-chain USDC is funded", async () => {
  render(<QueryClientProvider client={new QueryClient()}><OrderTicket account={{ id: "a", kind: "passkey" }} marketPrice={5} signIn={() => {}} /></QueryClientProvider>);
  expect((await screen.findByTestId("funding-asset")).textContent).toBe(DEFAULT_PAIR.quote.assetId);
  expect(screen.queryByRole("combobox", { name: "Funding balance" })).toBeNull();
});
