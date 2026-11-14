import { DEFAULT_PAIR } from "@dya/wallet-contracts/src/domain/catalog";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletReview } from "../../id/components/wallet-review";
vi.mock("@dya/wallet-ui/components/near/asset-mark", () => ({ AssetMark: () => null }));
afterEach(cleanup);
function detail(label: string) { return screen.getByText(label, { selector: "dt" }).parentElement!; }
it("shows the withdrawal source amount as well as its estimated receipt and destination", () => {
  const recipient = "0x" + "a".repeat(40);
  render(<WalletReview review={{ title: "Review withdrawal", details: { asset: "USDC", amount: "100", estimatedReceive: "99.8", minimumReceived: "98.8", recipient, network: "Base", expires: "2099-01-01T00:00:00Z" } }} />);
  expect(screen.getByText("99.8 USDC")).toBeInTheDocument();
  expect(within(detail("Amount")).getByText("100")).toBeInTheDocument();
  expect(within(detail("Recipient")).getByText(recipient)).toBeInTheDocument();
  expect(within(detail("Network")).getByText("Base")).toBeInTheDocument();
  expect(within(detail("Minimum received")).getByText("98.8")).toBeInTheDocument();
});
it("keeps funding minimum visible and exact route amounts behind Details", () => {
  render(<WalletReview now={0} review={{ title: "Review funding conversion", details: { asset: "NEAR", amount: "25", outputAsset: "USDC", estimatedOutput: "99.123456", minimumOutput: "98", expires: 65000 } }} />);
  expect(screen.getByText("≈ 99.12 USDC")).toBeVisible();
  expect(screen.getByText("98 USDC")).toBeVisible();
  expect(screen.getByText("25 NEAR")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText("25 NEAR")).toBeVisible();
  expect(screen.getByText("99.123456 USDC")).toBeVisible();
  expect(screen.getByText("1:05")).toBeVisible();
});

it("does not duplicate an amount-only headline in the detail rows", () => {
  render(<WalletReview review={{ details: { asset: "NEAR", amount: "1" } }} />);
  expect(screen.getByText("1 NEAR")).toBeInTheDocument();expect(screen.getAllByText("Amount")).toHaveLength(1);
});
it("keeps full market amounts in tooltips without duplicating pay/receive rows", () => {
  render(<WalletReview review={{title:"Review market trade",details:{inputAsset:"USDC",inputAmount:"0.247399",outputAsset:"ETH",estimatedOutput:"0.000101093236733584",minimumOutput:"0.000101093236733584",expires:65000}}} now={0} />);
  expect(screen.getByText("0.24 USDC")).toHaveAttribute("title", "0.247399 USDC");
  fireEvent.click(screen.getByRole("button", {name:"Details"}));
  expect(screen.getAllByText("You pay")).toHaveLength(1);
  expect(screen.getAllByText("You receive")).toHaveLength(1);
  expect(screen.queryByText("Estimated receive")).toBeNull();
  expect(screen.queryByText("Minimum received")).toBeNull();
  expect(screen.getByText("1:05")).toBeVisible();
});

it("identifies the base token and quote currency of a limit funding review", () => {
  render(<WalletReview review={{ title: "Fund limit order", details: { side: "sell", asset: "SOL", quantity: "1", price: "4", quoteAsset: "USDC", fundingAsset: "SOL", fundingAmount: "1", fees: "Included" } }} />);
  expect(screen.getByText("You receive at limit")).toBeVisible();
  expect(screen.getByText("1 SOL")).toBeVisible();
  expect(within(detail("Limit price")).getByText("4 USDC")).toBeInTheDocument();
  expect(screen.getByText("You pay")).toBeVisible();
});
it("explains confidential unlock without inventing transaction amounts", () => {
  render(<WalletReview review={{ title: "Unlock confidential balances", details: {} }} />);
  expect(screen.getByText("Use your passkey to access your confidential balances.")).toBeInTheDocument();
  expect(screen.queryByText("Amount")).not.toBeInTheDocument();
});
it("keeps backup authorization distinct from active recovery", () => {
  render(<WalletReview review={{ title: "Confirm backup passkey setup", details: {} }} />);
  expect(screen.getByText("Approve backup passkey setup. Recovery is not active yet.")).toBeInTheDocument();
});
it("does not fabricate details when no review is supplied", () => {
  const { container } = render(<WalletReview />);expect(container.textContent).toBe("");
});

it("values each side with its own available catalog price", () => {
 render(<WalletReview review={{title:"Review market trade",details:{inputAsset:"USDC",inputAmount:"10",outputAsset:"NEAR",estimatedOutput:"2",sourceAsset:{...DEFAULT_PAIR.quote,price:"0.99"},destinationAsset:{...DEFAULT_PAIR.base,price:"4"}}}} />);
 expect(screen.getByText("$9.90")).toBeVisible();
 expect(screen.getByText("$8.00")).toBeVisible();
});
it("hides unavailable prices independently and formats below-cent USD values", () => {
 const view = render(<WalletReview review={{title:"Review market trade",details:{inputAsset:"USDC",inputAmount:"1",outputAsset:"NEAR",estimatedOutput:"0.001",sourceAsset:DEFAULT_PAIR.quote,destinationAsset:{...DEFAULT_PAIR.base,price:"5"}}}} />);
 expect(screen.getByText("<$0.01")).toBeVisible();
 expect(screen.queryByText("$1.00")).toBeNull();
 view.rerender(<WalletReview review={{title:"Review market trade",details:{inputAsset:"USDC",inputAmount:"1",outputAsset:"NEAR",estimatedOutput:"0.001",sourceAsset:{...DEFAULT_PAIR.quote,price:"0"},destinationAsset:DEFAULT_PAIR.base}}} />);
 expect(screen.queryByText(/\$/)).toBeNull();
});

it.each(["buy", "sell"] as const)("shows quote-derived rate and NEAR Intents route for a %s without repeating amounts", side => {
 render(<WalletReview review={{title:"Review market trade",details:{side,inputAsset:side === "buy" ? "USDC" : "ETH",inputAmount:side === "buy" ? "2400" : "1",outputAsset:side === "buy" ? "ETH" : "USDC",estimatedOutput:side === "buy" ? "1" : "2400"}}} />);
 expect(screen.queryByText("NEAR Intents")).not.toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Details"}));
 expect(detail("Rate")).toHaveTextContent("1 ETH = 2,400 USDC");
 expect(screen.getByText("NEAR Intents")).toBeVisible();
 expect(screen.queryByText("Minimum received")).toBeNull();
 expect(screen.queryByText("Fee")).toBeNull();
});
it("omits exchange rates when quote amounts cannot form a positive rate", () => {
 render(<WalletReview review={{title:"Review market trade",details:{inputAmount:"1",estimatedOutput:"0"}}} />);
 fireEvent.click(screen.getByRole("button",{name:"Details"}));
 expect(screen.queryByText("Rate")).toBeNull();
 expect(screen.getByText("NEAR Intents")).toBeVisible();
});

it("shows compact limit size, actual funding and price without promising a fill", () => {
  render(<WalletReview now={0} review={{ title: "Fund limit order", details: { side: "buy", baseAsset: DEFAULT_PAIR.base, sourceAsset: DEFAULT_PAIR.quote, quantity: "0.020872992018167852252613", price: "4.79088", quoteAsset: "USDC", fundingAsset: "USDC", fundingAmount: "0.1", fees: "Included in funding", dyaFeeBps: 0, orderExpires: new Date(86400000).toISOString(), expires: 60000 } }} />);
  expect(screen.getByText("You receive at limit")).toBeVisible();
  expect(screen.getByText("You pay")).toBeVisible();
  expect(screen.getByText("0.0208 NEAR")).toBeVisible();
  expect(screen.getByText("0.10 USDC")).toBeVisible();
  expect(screen.queryByText("You receive")).toBeNull();
  expect(screen.getByText("4.79088 USDC")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText("0%")).toBeVisible();
  expect(screen.getByText("1:00")).toBeVisible();
});

it.each(["buy", "sell"] as const)("values %s receipt using the received token’s current USD price", side => {
  const base = { ...DEFAULT_PAIR.base, price: "6" };
  const quote = { ...DEFAULT_PAIR.quote, price: "0.98" };
  render(<WalletReview review={{ title: "Fund limit order", details: { side, baseAsset: base, quoteToken: quote, sourceAsset: side === "buy" ? quote : base, fundingAsset: side === "buy" ? "USDC" : "NEAR", fundingAmount: side === "buy" ? "10.01" : "2", quantity: "2", price: "5", quoteAsset: "USDC" } }} />);
  expect(screen.getByTitle("Value at the current market price")).toHaveTextContent(side === "buy" ? "$12.00" : "$9.80");
  expect(screen.getByText(side === "buy" ? "2 NEAR" : "10.00 USDC")).toBeVisible();
  const labels = screen.getAllByText(/You pay|You receive at limit/);
  expect(labels.map(label => label.textContent)).toEqual(["You pay", "You receive at limit"]);
});

it("hides a limit-buy receive valuation when base pricing is unavailable", () => {
  render(<WalletReview review={{ title: "Fund limit order", details: { side: "buy", baseAsset: DEFAULT_PAIR.base, quoteToken: { ...DEFAULT_PAIR.quote, price: "1" }, sourceAsset: { ...DEFAULT_PAIR.quote, price: "1" }, quantity: "2", price: "5", fundingAmount: "10", fundingAsset: "USDC", quoteAsset: "USDC" } }} />);
  expect(screen.queryByTitle("Value at the current market price")).not.toBeInTheDocument();
  expect(screen.getByText("$10.00")).toBeVisible();
});

it("shows the reviewed market fee breakdown separately from slippage",()=>{
  const fees="25 bps (0.25%) listed trading fees: DYA 5 bps; provider 20 bps.";
  render(<WalletReview review={{title:"Review market trade",details:{inputAmount:"10",estimatedOutput:"2",fees,dyaFeeBps:5,slippageBps:30}}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Details"}));
  expect(screen.getByText("0.05%")).toBeVisible();
  expect(screen.getByRole("button", { name: "Fees" })).toBeVisible();
  expect(screen.getByText("Max slippage")).toBeVisible();
});

it.each(["Review market trade", "Fund limit order"])("shows zero DYA fees in %s without expanding details", title => {
  render(<WalletReview review={{ title, details: { dyaFeeBps: 0 } }} />);
  expect(screen.getByRole("button", { name: "Fees" })).toBeVisible();
  expect(screen.getByText("0%")).toBeVisible();
});
