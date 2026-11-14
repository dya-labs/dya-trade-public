import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { finishConnection, getRegistrationOptions } from "../../id/lib/wallet-client";
import { WalletFlow } from "../../id/components/wallet-flow";
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(async () => ({ id: "synthetic" })), startRegistration: vi.fn(async () => ({ id: "synthetic" })) }));
vi.mock("../../id/lib/wallet-client", () => ({ WalletRequestError: class WalletRequestError extends Error {}, getLoginOptions: vi.fn(async () => ({})), getRegistrationOptions: vi.fn(async () => ({})), loginPasskey: vi.fn(), registerPasskey: vi.fn(), finishConnection: vi.fn(), finishApproval: vi.fn() }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock("../../id/components/wallet-recovery", () => ({ WalletRecovery: ({ onComplete }: { onComplete: () => Promise<void> }) => <button onClick={() => void onComplete()}>Synthetic recovery complete</button> }));
const props = { id: "synthetic-flow", kind: "connect" as const, clientOrigin: "http://localhost:3100", callback: "http://localhost:3100/api/wallet/callback", review: {}, options: {}, status: "pending" };
const opener = window.opener;
const postMessage = vi.fn();
beforeEach(() => { vi.mocked(finishConnection).mockResolvedValue({ code: "synthetic-one-time-code", callback: props.callback, clientOrigin: props.clientOrigin });Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true }); });
afterEach(() => { cleanup();vi.clearAllMocks();Object.defineProperty(window, "opener", { value: opener, configurable: true }); });
/** Messages sent to Terminal other than the `dya:ready` timing report, which the flow posts when it opens. */
const resultMessages = () => postMessage.mock.calls.map(([message]) => message.type).filter(type => type !== "dya:ready");
it.each(["Sign in", "Create account"])("locks completed %s without reopening authentication", async action => {
  render(<WalletFlow {...props} />);fireEvent.click(screen.getByRole("button", { name: action }));
  if (action === "Create account") {
    // Registration asks for a private account name between the welcome and the passkey ceremony.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  }
  await act(async () => {});
  if (action === "Create account") expect(getRegistrationOptions).toHaveBeenCalledWith("Alice");
  expect(finishConnection).toHaveBeenCalledOnce();expect(postMessage).toHaveBeenCalledWith({ type: "dya:complete", flowId: props.id, code: "synthetic-one-time-code" }, props.clientOrigin);
  expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Connection approved. Return to Terminal to continue.");
});
it("returns the original connection code without creating another grant", async () => {
  render(<WalletFlow {...props} />);fireEvent.click(screen.getByRole("button", { name: "Sign in" }));await act(async () => {});
  postMessage.mockClear();fireEvent.click(screen.getByRole("button", { name: "Return to Terminal" }));
  expect(postMessage).toHaveBeenCalledWith({ type: "dya:complete", flowId: props.id, code: "synthetic-one-time-code" }, props.clientOrigin);
  expect(finishConnection).toHaveBeenCalledOnce();expect(startAuthentication).toHaveBeenCalledOnce();
});
it("keeps authentication retry available when connection completion fails", async () => {
  vi.mocked(finishConnection).mockRejectedValueOnce(new Error("Synthetic transport failure"));
  render(<WalletFlow {...props} />);fireEvent.click(screen.getByRole("button", { name: "Sign in" }));await act(async () => {});
  expect(screen.getByText("Could not connect. Try signing in again or create a wallet.")).toBeInTheDocument();expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();expect(resultMessages()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));await act(async () => {});
  expect(finishConnection).toHaveBeenCalledTimes(2);expect(screen.getByRole("button", { name: "Return to Terminal" })).toBeInTheDocument();
});
it("uses the same completed connection state after recovery continuation", async () => {
  render(<WalletFlow {...props} recoveryEnabled />);fireEvent.click(screen.getByRole("button", { name: "Recover" }));
  // The recovery screen loads on demand.
  fireEvent.click(await screen.findByRole("button", { name: "Synthetic recovery complete" }));await act(async () => {});
  expect(screen.queryByRole("button", { name: "Synthetic recovery complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Return to Terminal" })).toBeInTheDocument();expect(finishConnection).toHaveBeenCalledOnce();expect(startRegistration).not.toHaveBeenCalled();
});
