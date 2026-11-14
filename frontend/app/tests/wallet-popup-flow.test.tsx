import { TOAST_MESSAGES } from "@dya/config";
import { toast } from "@dya/ui/lib/toast";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { finishApproval } from "../../id/lib/wallet-client";
import { WalletFlow } from "../../id/components/wallet-flow";
import { getSession, logout } from "@dya/wallet-ui/lib/near/http/account-client";
vi.mock("@dya/wallet-ui/lib/near/http/account-client", () => ({ getSession: vi.fn(async () => ({ account: null, passkeyOrigin: "http://localhost:3101" })), logout: vi.fn(async () => ({ ok: true })) }));
vi.mock("@dya/ui/lib/toast", () => ({ toast: vi.fn() }));
const opener = { postMessage: vi.fn(), focus: vi.fn() };
vi.mock("../../id/lib/wallet-client", () => ({ getLoginOptions: vi.fn(async () => ({ challenge: "challenge" })), loginPasskey: vi.fn(), finishConnection: vi.fn(async () => ({ code: "one-time-code" })), getRegistrationOptions: vi.fn(), registerPasskey: vi.fn(), finishApproval: vi.fn(async () => ({ status: 200 })) }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(async () => ({ id: "credential" })), startRegistration: vi.fn() }));
const props = { id: "flow", kind: "connect" as const, clientOrigin: "http://localhost:3110", callback: "http://localhost:3110/api/wallet/callback", review: undefined, options: undefined, status: "pending" };
beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(window, "opener", { value: opener, configurable: true }); });
afterEach(() => { Object.defineProperty(window, "opener", { value: null, configurable: true }); });
/** Messages sent to `receiver` other than the `dya:ready` timing report, which the flow posts when it opens. */
const resultMessages = (receiver: { postMessage: Mock }) => receiver.postMessage.mock.calls.map(([message]) => message.type).filter(type => type !== "dya:ready");
it("returns a connection code to the opener instead of navigating Terminal", async () => {
  render(<WalletFlow {...props} />); fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(opener.postMessage).toHaveBeenCalledWith({ type: "dya:complete", flowId: "flow", code: "one-time-code" }, props.clientOrigin));
});
it("returns an approval completion to the opener so the original app promise can resume", async () => {
  render(<WalletFlow {...props} kind="approval" options={{ challenge: "challenge" }} />); fireEvent.click(screen.getByRole("button", { name: "Confirm with passkey" }));
  await waitFor(() => expect(opener.postMessage).toHaveBeenCalledWith({ type: "dya:complete", flowId: "flow" }, props.clientOrigin));
});
it("sends cancellation to the opener for SDK cleanup", () => {
  render(<WalletFlow {...props} />); fireEvent.click(screen.getByRole("button", { name: "Close wallet" }));
  expect(opener.postMessage).toHaveBeenCalledWith({ type: "dya:cancel", flowId: "flow" }, props.clientOrigin);
});

it("keeps a failed operation visible until the user returns to Terminal", async () => {
  vi.mocked(finishApproval).mockResolvedValueOnce({ status: 400, body: {}, callback: props.callback, clientOrigin: props.clientOrigin });
  render(<WalletFlow {...props} kind="approval" />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm with passkey" }));
  await screen.findByText("The wallet could not complete this operation. Return to Terminal to check its status.");
  expect(resultMessages(opener)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Return to Terminal" }));
  expect(opener.postMessage).toHaveBeenCalledWith({ type: "dya:complete", flowId: "flow" }, props.clientOrigin);
});
it("shows cancellation recovery without leaking raw browser errors", async () => {
  vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Sensitive browser detail", "NotAllowedError"));
  render(<WalletFlow {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(toast).toHaveBeenCalledExactlyOnceWith(TOAST_MESSAGES.confirmationCancelled));
  expect(screen.queryByText("Sensitive browser detail")).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  expect(resultMessages(opener)).toEqual([]);
});
it("presents estimated receipts and meaningful withdrawal actions", () => {
  render(<WalletFlow {...props} kind="approval" review={{ title: "Review withdrawal", details: { asset: "USDC", estimatedReceive: "99.80", recipient: "recipient" } }} />);
  expect(screen.getByText("Estimated receive")).toBeTruthy();
  expect(screen.getByText("99.80 USDC")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirm withdrawal" })).toBeTruthy();
});

it("offers popup recovery only after an embedded compatibility failure", async () => {
  const parent = window.parent;
  const receiver = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { value: receiver, configurable: true });
  try {
    vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Unsupported context", "NotSupportedError"));
    render(<WalletFlow {...props} />);
    expect(screen.queryByRole("button", { name: "Continue in popup" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const action = await screen.findByRole("button", { name: "Continue in popup" });
    expect(receiver.postMessage.mock.calls.some(([data]) => data.type === "dya:fallback")).toBe(false);
    fireEvent.click(action);
    expect(receiver.postMessage).toHaveBeenCalledWith({ type: "dya:fallback", flowId: "flow" }, props.clientOrigin);
  } finally { Object.defineProperty(window, "parent", { value: parent, configurable: true }); }
});

it("does not offer account switching without an ID session", async () => {
  render(<WalletFlow {...props} />);
  await waitFor(() => expect(getSession).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Switch account" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});

it("switches account by signing out of ID without completing or cancelling the connection", async () => {
  vi.mocked(getSession).mockResolvedValueOnce({ account: { id: "alice.dya", kind: "passkey", name: "Alice" }, passkeyOrigin: "http://localhost:3101" });
  render(<WalletFlow {...props} />);
  await screen.findByText("Alice");
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Switch account" }));
  await waitFor(() => expect(screen.queryByText("Alice")).toBeNull());
  expect(logout).toHaveBeenCalledOnce();
  expect(resultMessages(opener)).toEqual([]);
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
});

it("allows switching accounts after a cancelled confirmation", async () => {
  vi.mocked(getSession).mockResolvedValueOnce({ account: { id: "alice.dya", kind: "passkey", name: "Alice" }, passkeyOrigin: "http://localhost:3101" });
  vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
  render(<WalletFlow {...props} />);
  await screen.findByText("Alice");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(toast).toHaveBeenCalledExactlyOnceWith(TOAST_MESSAGES.confirmationCancelled));
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Switch account" }));
  await waitFor(() => expect(screen.queryByText("Alice")).toBeNull());
  expect(screen.queryByText("Passkey confirmation was cancelled. Try again when you’re ready.")).toBeNull();
  expect(resultMessages(opener)).toEqual([]);
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
});

it.each(["expired", "started"])("explains a %s flow and returns without offering another confirmation", status => {
  render(<WalletFlow {...props} kind="approval" status={status} />);
  expect(screen.getByText(status === "expired" ? "This request expired. Return to Terminal and start again." : "This request has already started. Return to Terminal and check its status.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm with passkey" })).not.toBeInTheDocument();
  expect(startAuthentication).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Return to Terminal" }));
  expect(opener.postMessage).toHaveBeenCalledWith({ type: "dya:cancel", flowId: "flow" }, props.clientOrigin);
});

it("preserves recovery intent when requesting embedded popup fallback", () => {
  const parent = window.parent, receiver = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { value: receiver, configurable: true });
  try {
    render(<WalletFlow {...props} recoveryEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    expect(receiver.postMessage).toHaveBeenCalledWith({ type: "dya:fallback", flowId: "flow", screen: "recover" }, props.clientOrigin);
  } finally { Object.defineProperty(window, "parent", { value: parent, configurable: true }); }
});

it("opens the requested recovery screen in a pending popup and allows Back", () => {
  render(<WalletFlow {...props} recoveryEnabled initialScreen="recover" />);
  expect(screen.getByRole("heading", { name: "Recover account" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Get started" })).toBeInTheDocument();
});

it.each([
  { kind: "connect" as const, status: "pending", recoveryEnabled: false },
  { kind: "approval" as const, status: "pending", recoveryEnabled: true },
  { kind: "connect" as const, status: "expired", recoveryEnabled: true },
  { kind: "connect" as const, status: "started", recoveryEnabled: true },
])("does not use a recovery screen hint outside enabled pending connection: %j", scenario => {
  render(<WalletFlow {...props} {...scenario} initialScreen="recover" />);
  expect(screen.queryByRole("heading", { name: "Recover account" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Connect recovery wallet" })).not.toBeInTheDocument();
  expect(startAuthentication).not.toHaveBeenCalled();
});
