import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAuthentication } from "@simplewebauthn/browser";
import { finishApproval } from "../../id/lib/wallet-client";
import { WalletFlow } from "../../id/components/wallet-flow";
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock("../../id/lib/wallet-client", () => ({ finishApproval: vi.fn(), getLoginOptions: vi.fn(), getRegistrationOptions: vi.fn(), loginPasskey: vi.fn(), registerPasskey: vi.fn(), finishConnection: vi.fn() }));
const now = Date.UTC(2026, 9, 17, 0);
const props = { id: "synthetic", kind: "approval" as const, clientOrigin: "http://localhost:3100", callback: "http://localhost:3100/api/wallet/callback", review: { title: "Review market trade", details: {} }, options: { challenge: "synthetic" }, status: "pending" };
const assertion = { id: "synthetic" } as Awaited<ReturnType<typeof startAuthentication>>;
const result = { status: 400, body: {}, clientOrigin: props.clientOrigin, callback: props.callback };
const previousOpener = window.opener;
beforeEach(() => { vi.useFakeTimers();vi.setSystemTime(now);Object.defineProperty(window, "opener", { value: { postMessage: vi.fn() }, configurable: true });vi.mocked(startAuthentication).mockResolvedValue(assertion);vi.mocked(finishApproval).mockResolvedValue(result); });
afterEach(() => { cleanup();vi.useRealTimers();vi.resetAllMocks();Object.defineProperty(window, "opener", { value: previousOpener, configurable: true }); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function expired() { expect(screen.getByRole("status")).toHaveTextContent("Quote expired");expect(screen.queryByRole("button", { name: "Confirm buy" })).not.toBeInTheDocument();expect(screen.getByRole("button", { name: "Review again" })).toBeInTheDocument(); }

it("expires an idle approval when its hosted request deadline passes", async () => {
  render(<WalletFlow {...props} expiresAt={now + 1000} />);
  expect(screen.getByRole("button", { name: "Confirm buy" })).toBeEnabled();
  await advance(1001);expired();expect(startAuthentication).not.toHaveBeenCalled();
});
it("uses an earlier ISO quote deadline even while the hosted request is still valid", async () => {
  render(<WalletFlow {...props} expiresAt={now + 60_000} review={{ ...props.review, details: { expires: new Date(now + 1000).toISOString() } }} />);
  await advance(1001);expired();
});
it("checks the deadline at click time before the next display timer tick", async () => {
  render(<WalletFlow {...props} expiresAt={now + 1000} />);
  vi.setSystemTime(now + 1001);fireEvent.click(screen.getByRole("button", { name: "Confirm buy" }));
  await act(async () => {});expired();expect(startAuthentication).not.toHaveBeenCalled();expect(finishApproval).not.toHaveBeenCalled();
});
it("does not publish an assertion when the request expires during passkey confirmation", async () => {
  let resolve!: (value: typeof assertion) => void;
  vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<WalletFlow {...props} expiresAt={now + 1000} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm buy" }));
  await advance(1001);await act(async () => { resolve(assertion); });
  expired();expect(finishApproval).not.toHaveBeenCalled();
});
it("fails closed on a declared invalid approval deadline", () => {
  render(<WalletFlow {...props} expiresAt={now + 60_000} review={{ ...props.review, details: { expires: "invalid" } }} />);
  expired();expect(startAuthentication).not.toHaveBeenCalled();
});
it("preserves in-flight submission and outcome guidance when the display deadline passes", async () => {
  let resolve!: (value: typeof result) => void;
  vi.mocked(finishApproval).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<WalletFlow {...props} expiresAt={now + 1000} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm buy" }));await act(async () => {});
  expect(finishApproval).toHaveBeenCalledOnce();await advance(1001);
  expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
  expect(screen.queryByText("This request expired. Return to Terminal and start again.")).not.toBeInTheDocument();
  await act(async () => { resolve(result); });
  expect(screen.getByText("The wallet could not complete this operation. Return to Terminal to check its status.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Return to Terminal" })).toBeInTheDocument();expect(finishApproval).toHaveBeenCalledOnce();
});
it("does not reopen confirmation after a completed approval response", async () => {
  vi.mocked(finishApproval).mockResolvedValueOnce({ ...result, status: 200 });
  render(<WalletFlow {...props} expiresAt={now + 1000} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm buy" }));await act(async () => {});
  expect(screen.queryByRole("button", { name: "Confirm buy" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Return to Terminal" })).toBeInTheDocument();
  await advance(1001);expect(screen.queryByText("This request expired. Return to Terminal and start again.")).not.toBeInTheDocument();
  expect(finishApproval).toHaveBeenCalledOnce();
});
it("removes compatibility popup recovery after the approval expires", async () => {
  const parent = window.parent;
  Object.defineProperty(window, "parent", { value: { postMessage: vi.fn() }, configurable: true });
  try {
    vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Synthetic incompatible context", "SecurityError"));
    render(<WalletFlow {...props} expiresAt={now + 1000} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm buy" }));await act(async () => {});
    expect(screen.getByRole("button", { name: "Continue in popup" })).toBeEnabled();
    await advance(1001);expired();expect(screen.queryByRole("button", { name: "Continue in popup" })).not.toBeInTheDocument();
  } finally { cleanup();Object.defineProperty(window, "parent", { value: parent, configurable: true }); }
});

it("returns expired market reviews to the existing ticket without confirming or submitting", async () => {
 render(<WalletFlow {...props} expiresAt={now - 1} />);
 await advance(1);
 fireEvent.click(screen.getByRole("button", {name:"Review again"}));
 expect(window.opener.postMessage).toHaveBeenCalledWith({type:"dya:retry",flowId:"synthetic"}, props.clientOrigin);
 expect(startAuthentication).not.toHaveBeenCalled();
 expect(finishApproval).not.toHaveBeenCalled();
});

it("gives limit funding one explicit confirmation and expiry recovery without signing", async () => {
  render(<WalletFlow {...props} expiresAt={now + 1000} review={{ title: "Fund limit order", details: { side: "sell", asset: "NEAR", quantity: "1", fundingAsset: "NEAR", fundingAmount: "1", price: "4", quoteAsset: "USDC" } }} />);
  expect(screen.getByRole("heading", { name: "Review limit sell" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm limit sell" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  await advance(1001);
  expect(screen.getByRole("status")).toHaveTextContent("Confirmation expired");
  fireEvent.click(screen.getByRole("button", { name: "Review again" }));
  expect(window.opener.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "dya:retry" }), props.clientOrigin);
  expect(startAuthentication).not.toHaveBeenCalled();
});
