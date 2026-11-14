import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PAIR, type SelectedPair } from "@/lib/near/domain/catalog";
import { OrderTicket } from "@/components/near/funded-ticket";

const state = vi.hoisted(() => ({ assets: [] as unknown[], balances: [] as unknown[] }));
vi.mock("@dya/wallet-ui/hooks/use-wallet-queries", () => ({ useCatalogQuery: () => ({ data: { assets: state.assets } }) }));
vi.mock("@/components/near/use-live-balances", () => ({ useBalanceQuery: () => ({ data: { assets: state.balances } }) }));
vi.mock("@/components/near/ticket", () => ({ OrderTicketForm: ({ pair, onBusyChange }: { pair: SelectedPair; onBusyChange: (value: boolean) => void }) => <div>
  <output data-testid="selected-base">{pair.base.assetId}</output><output data-testid="selected-quote">{pair.quote.assetId}</output>
  <button onClick={() => onBusyChange(true)}>Begin review</button><button onClick={() => onBusyChange(false)}>Close review</button>
</div> }));
const base = { ...DEFAULT_PAIR.base, coingeckoId: "near" };
const variant = { ...base, assetId: "nep141:synthetic-near-on-base", blockchain: "base" };
const unfunded = { ...base, assetId: "nep141:synthetic-near-on-eth", blockchain: "eth" };
const unrelated = { ...base, assetId: "nep141:synthetic-unrelated", coingeckoId: "different-token" };
const props = { account: { id: "synthetic-account", kind: "passkey" as const }, marketPrice: 5, signIn: () => {}, pair: { ...DEFAULT_PAIR, base } };
beforeEach(() => {
  state.assets = [base, variant, unfunded, unrelated];
  state.balances = [base, variant, unrelated].map(asset => ({ ...asset, amount: "2", raw: "2000000" }));
});

afterEach(cleanup);
it("shows the selected network and balance instead of its internal asset identity", async () => {
  render(<OrderTicket {...props} />);
  const selector = screen.getByRole("combobox", { name: "NEAR balance" });
  expect(selector).toHaveTextContent("NEAR · 2 NEAR");
  expect(selector).not.toHaveTextContent(base.assetId);
  fireEvent.click(selector);
  const option = await screen.findByRole("option", { name: "Base · 2 wNEAR" });
  fireEvent.pointerDown(option, { button: 0 });
  fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(selector).toHaveTextContent("Base · 2 wNEAR"));
  expect(selector).not.toHaveTextContent(variant.assetId);
  expect(screen.getByTestId("selected-base")).toHaveTextContent(variant.assetId);
  expect(screen.getByTestId("selected-quote")).toHaveTextContent(DEFAULT_PAIR.quote.assetId);
});
it("disables the real shared network selector while the ticket is in review", () => {
  render(<OrderTicket {...props} />);
  const selector = screen.getByRole("combobox", { name: "NEAR balance" });
  fireEvent.click(screen.getByRole("button", { name: "Begin review" }));
  expect(selector).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close review" }));
  expect(selector).toBeEnabled();
});

async function chooseBaseNetwork() {
  const selector = screen.getByRole("combobox", { name: "NEAR balance" });
  fireEvent.click(selector);
  const option = await screen.findByRole("option", { name: "Base · 2 wNEAR" });
  fireEvent.pointerDown(option, { button: 0 });
  fireEvent.click(option, { detail: 1 });
  await waitFor(() => expect(selector).toHaveTextContent("Base · 2 wNEAR"));
  return selector;
}
it("refreshes selected network amounts and retains its explicit zero balance", async () => {
  const view = render(<OrderTicket {...props} />);
  const selector = await chooseBaseNetwork();
  state.balances = [{ ...base, amount: "2", raw: "2000000" }, { ...variant, amount: "3.5", raw: "3500000" }];
  view.rerender(<OrderTicket {...props} />);
  expect(selector).toHaveTextContent("Base · 3.5 wNEAR");
  state.balances = [{ ...base, amount: "2", raw: "2000000" }, { ...variant, amount: "0", raw: "0" }];
  view.rerender(<OrderTicket {...props} />);
  expect(selector).toHaveTextContent("Base · 0 wNEAR");
  expect(screen.getByTestId("selected-base")).toHaveTextContent(variant.assetId);
});
it("keeps the selected network identity but marks a missing balance unavailable", async () => {
  const view = render(<OrderTicket {...props} />);
  const selector = await chooseBaseNetwork();
  state.balances = [{ ...base, amount: "2", raw: "2000000" }];
  view.rerender(<OrderTicket {...props} />);
  expect(selector).toHaveTextContent("Base · - wNEAR");
  expect(selector).not.toHaveTextContent("Base · 0 wNEAR");
  expect(screen.getByTestId("selected-base")).toHaveTextContent(variant.assetId);
});

it("discovers funded network variants from the exact canonical catalog row when initial pair metadata is sparse", async () => {
  render(<OrderTicket {...props} pair={DEFAULT_PAIR} />);
  const selector = screen.getByRole("combobox", { name: "NEAR balance" });
  expect(selector).toHaveTextContent("NEAR · 2 NEAR");
  fireEvent.click(selector);
  expect(await screen.findByRole("option", { name: "Base · 2 wNEAR" })).toBeVisible();
  expect(screen.queryByRole("option", { name: "Ethereum · 0 wNEAR" })).toBeNull();
});
it("does not infer network variants from a same-symbol catalog asset without the exact canonical identity", () => {
  state.assets = [variant, unfunded, unrelated];
  render(<OrderTicket {...props} pair={DEFAULT_PAIR} />);
  expect(screen.queryByRole("combobox", { name: "NEAR balance" })).toBeNull();
  expect(screen.getByTestId("selected-base")).toHaveTextContent(DEFAULT_PAIR.base.assetId);
});
