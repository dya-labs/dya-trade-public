import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PAIR, type SelectedPair } from "@/lib/near/domain/catalog";
import { OrderTicket } from "@/components/near/funded-ticket";

const state = vi.hoisted(() => ({ assets: [] as unknown[], balances: [] as unknown[] }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: state.assets } }) }));
vi.mock("@/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: { assets: state.balances } }) }));
vi.mock("@/components/near/ticket", () => ({ OrderTicketForm: ({ pair, onBusyChange }: { pair: SelectedPair; onBusyChange: (value: boolean) => void }) => <div>
  <output data-testid="selected-base">{pair.base.assetId}</output><output data-testid="selected-quote">{pair.quote.assetId}</output>
  <button onClick={() => onBusyChange(true)}>Begin review</button><button onClick={() => onBusyChange(false)}>Close review</button>
</div> }));
vi.mock("@dya/ui/components/select", () => ({
  Select: ({ children, value, disabled, onValueChange }: { children: React.ReactNode; value: string; disabled: boolean; onValueChange: (value: string) => void }) => <select aria-label="Base network" value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
const base = { ...DEFAULT_PAIR.base, coingeckoId: "near" };
const variant = { ...base, assetId: "nep141:synthetic-near-on-base", blockchain: "base" };
const unfunded = { ...base, assetId: "nep141:synthetic-near-on-eth", blockchain: "eth" };
const unrelated = { ...base, assetId: "nep141:synthetic-unrelated", coingeckoId: "different-token" };
const props = { account: { id: "synthetic-account", kind: "passkey" as const }, marketPrice: 5, signIn: () => {}, pair: { ...DEFAULT_PAIR, base } };
beforeEach(() => {
  state.assets = [base, variant, unfunded, unrelated];
  state.balances = [base, variant, unrelated].map(asset => ({ ...asset, amount: "2", raw: "2000000" }));
});

it("offers only funded matching base identities and retains a selected spent variant", () => {
  const view = render(<OrderTicket {...props} />);
  const selector = screen.getByRole("combobox", { name: "Base network" });
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.getByTestId("selected-base")).toHaveTextContent(base.assetId);
  fireEvent.change(selector, { target: { value: variant.assetId } });
  expect(screen.getByTestId("selected-base")).toHaveTextContent(variant.assetId);
  expect(screen.getByTestId("selected-quote")).toHaveTextContent(DEFAULT_PAIR.quote.assetId);
  state.balances = [{ ...base, amount: "2", raw: "2000000" }, { ...variant, amount: "0", raw: "0" }];
  view.rerender(<OrderTicket {...props} />);
  expect(screen.getByRole("combobox", { name: "Base network" })).toHaveValue(variant.assetId);
  expect(screen.getByTestId("selected-base")).toHaveTextContent(variant.assetId);
});

it("locks network selection during review and reports busy transitions to its parent", () => {
  const busy = vi.fn();
  render(<OrderTicket {...props} onBusyChange={busy} />);
  fireEvent.click(screen.getByRole("button", { name: "Begin review" }));
  expect(screen.getByRole("combobox", { name: "Base network" })).toBeDisabled();
  expect(busy).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Close review" }));
  expect(screen.getByRole("combobox", { name: "Base network" })).toBeEnabled();
  expect(busy).toHaveBeenLastCalledWith(false);
});
