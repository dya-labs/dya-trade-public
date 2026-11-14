import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { getRegistrationOptions, getLoginOptions, registerPasskey, loginPasskey, finishConnection, finishApproval } from "../../id/lib/wallet-client";
import { toast } from "@dya/ui/lib/toast";
import { WalletFlow } from "../../id/components/wallet-flow";
vi.mock("@dya/ui/lib/toast", () => ({ toast: vi.fn() }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock("../../id/lib/wallet-client", () => ({ WalletRequestError: class WalletRequestError extends Error {}, getRegistrationOptions: vi.fn(), getLoginOptions: vi.fn(), registerPasskey: vi.fn(), loginPasskey: vi.fn(), finishConnection: vi.fn(), finishApproval: vi.fn() }));
const props = { id: "synthetic-old-flow", kind: "connect" as const, clientOrigin: "http://localhost:3100", callback: "http://localhost:3100/api/wallet/callback", review: {}, options: {}, status: "pending" };
const opener = window.opener, postMessage = vi.fn();
beforeEach(() => { vi.resetAllMocks();localStorage.clear();Object.defineProperty(window, "opener", { value: { postMessage }, configurable: true }); });
afterEach(() => { cleanup();Object.defineProperty(window, "opener", { value: opener, configurable: true }); });
const connections = (["register", "login"] as const).flatMap(kind => (["options", "device", "verification", "completion"] as const).map(stage => ({ kind, stage })));
it.each(connections)("stops hosted $kind connection after flow replacement during $stage", async ({ kind, stage }) => {
  let release!: () => void;const gate = new Promise<void>(resolve => { release = resolve; });
  async function step<T>(name: string, value: T): Promise<T> { if (stage === name) await gate;return value; }
  vi.mocked(getRegistrationOptions).mockImplementation(() => step("options", { challenge: "synthetic", rp: { id: "localhost", name: "Synthetic" } } as Awaited<ReturnType<typeof getRegistrationOptions>>));
  vi.mocked(getLoginOptions).mockImplementation(() => step("options", { challenge: "synthetic" } as Awaited<ReturnType<typeof getLoginOptions>>));
  vi.mocked(startRegistration).mockImplementation(() => step("device", { id: "synthetic" } as Awaited<ReturnType<typeof startRegistration>>));
  vi.mocked(startAuthentication).mockImplementation(() => step("device", { id: "synthetic" } as Awaited<ReturnType<typeof startAuthentication>>));
  vi.mocked(registerPasskey).mockImplementation(() => step("verification", { ok: true } as Awaited<ReturnType<typeof registerPasskey>>));
  vi.mocked(loginPasskey).mockImplementation(() => step("verification", { ok: true } as Awaited<ReturnType<typeof loginPasskey>>));
  vi.mocked(finishConnection).mockImplementation(() => step("completion", { code: "synthetic-code", callback: props.callback, clientOrigin: props.clientOrigin }));
  const calls = kind === "register" ? [getRegistrationOptions, startRegistration, registerPasskey, finishConnection] : [getLoginOptions, startAuthentication, loginPasskey, finishConnection];
  const stop = ["options", "device", "verification", "completion"].indexOf(stage);
  const view = render(<WalletFlow {...props} connectionKind={kind} />);
  fireEvent.click(screen.getByRole("button", { name: kind === "register" ? "Create account" : "Sign in" }));
  if (kind === "register") { fireEvent.click(screen.getByRole("button", { name: "Continue" })); fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test account" } }); fireEvent.click(screen.getByRole("button", { name: "Create account" })); }
  await waitFor(() => expect(calls[stop]).toHaveBeenCalledOnce());
  view.rerender(<WalletFlow {...props} id="synthetic-replacement-flow" connectionKind={kind} />);
  await act(async () => { release(); });
  for (const [i,call] of calls.entries()) expect(call).toHaveBeenCalledTimes(i <= stop ? 1 : 0);
  expect(postMessage.mock.calls.every(([message]) => message.type === "dya:ready")).toBe(true);
  expect(screen.getByRole("button", { name: kind === "register" ? "Create account" : "Sign in" })).toBeEnabled();
  expect(screen.queryByText("Connection approved. Return to Terminal to continue.")).toBeNull();
});
const approvals = (["registration", "authentication"] as const).flatMap(kind => (["device", "completion"] as const).map(stage => ({ kind, stage })));
it.each(approvals)("stops hosted $kind approval after flow replacement during $stage", async ({ kind, stage }) => {
  let release!: () => void;const gate = new Promise<void>(resolve => { release = resolve; });
  async function step<T>(name: string, value: T): Promise<T> { if (stage === name) await gate;return value; }
  vi.mocked(startRegistration).mockImplementation(() => step("device", { id: "synthetic" } as Awaited<ReturnType<typeof startRegistration>>));
  vi.mocked(startAuthentication).mockImplementation(() => step("device", { id: "synthetic" } as Awaited<ReturnType<typeof startAuthentication>>));
  vi.mocked(finishApproval).mockImplementation(() => step("completion", { status: 200, body: {}, callback: props.callback, clientOrigin: props.clientOrigin }));
  const actionProps = { ...props, kind: "approval" as const, options: kind === "registration" ? { challenge: "synthetic", rp: {} } : { challenge: "synthetic" } };
  const view = render(<WalletFlow {...actionProps} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm with passkey" }));
  await waitFor(() => expect(stage === "device" ? kind === "registration" ? startRegistration : startAuthentication : finishApproval).toHaveBeenCalledOnce());
  view.rerender(<WalletFlow {...actionProps} id="synthetic-replacement-flow" />);
  await act(async () => { release(); });
  expect(finishApproval).toHaveBeenCalledTimes(stage === "device" ? 0 : 1);
  expect(postMessage.mock.calls.every(([message]) => message.type === "dya:ready")).toBe(true);
  expect(screen.getByRole("button", { name: "Confirm with passkey" })).toBeEnabled();
});

it("defaults blank private names to Personal before starting account registration", async () => {
  render(<WalletFlow {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(screen.getByRole("heading", { name: "Welcome to Dya ID", level: 1 })).toBeVisible();
  expect(screen.getByText("Protected by")).toBeVisible();
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(getRegistrationOptions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  vi.mocked(getRegistrationOptions).mockRejectedValueOnce(new Error("synthetic failure"));
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(getRegistrationOptions).toHaveBeenCalledWith("Personal"));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(startRegistration).not.toHaveBeenCalled();
});
it("shows the private name on a returning account without exposing its UUID", () => {
  render(<WalletFlow {...props} session={{ account: { id: "private-internal-id", kind: "passkey", name: "Personal" }, passkeyOrigin: "https://id.example.test" }} />);
  expect(screen.getByRole("heading", { name: "Continue with Dya ID", level: 1 })).toBeVisible();
  expect(screen.getByText("Personal")).toBeVisible();
  expect(screen.queryByText("private-internal-id")).toBeNull();
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
});

it("keeps funding approval in ID and waits for explicit confirmation before opening the passkey prompt", async () => {
  vi.mocked(startAuthentication).mockImplementation(() => new Promise(() => {}));
  render(<WalletFlow {...props} kind="approval" review={{ title: "Review funding conversion", details: { asset: "USDC", estimatedOutput: "1", outputAsset: "USDC", minimumOutput: "0.99", estimatedCost: "-0.001" } }} options={{ challenge: "synthetic" }} />);
  expect(screen.getByText("Estimated to receive")).toBeVisible();
  expect(screen.getByText("0.99 USDC")).toBeVisible();
  expect(screen.getByText("-<$0.01")).toBeVisible();
  expect(startAuthentication).not.toHaveBeenCalled();
  expect(finishApproval).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  await waitFor(() => expect(startAuthentication).toHaveBeenCalledOnce());
  expect(finishApproval).not.toHaveBeenCalled();
});

it("uses a neutral toast and retry label when funding passkey confirmation is cancelled", async () => {
  vi.mocked(startAuthentication).mockRejectedValue(new DOMException("Cancelled", "NotAllowedError"));
  render(<WalletFlow {...props} kind="approval" review={{ title: "Review funding conversion", details: {} }} options={{ challenge: "synthetic" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
  expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
  expect(toast).toHaveBeenCalledWith("Confirmation cancelled");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(finishApproval).not.toHaveBeenCalled();
  expect(startAuthentication).toHaveBeenCalledOnce();
});

it.each([
  ["Unlock confidential balances", "Unlock balances"],
  ["Review withdrawal", "Confirm withdrawal"],
])("uses a neutral cancellation toast for %s", async (title, action) => {
  vi.mocked(startAuthentication).mockRejectedValueOnce(new DOMException("Cancelled", "NotAllowedError"));
  render(<WalletFlow {...props} kind="approval" review={{ title, details: {} }} options={{ challenge: "synthetic" }} />);
  fireEvent.click(screen.getByRole("button", { name: action }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Confirmation cancelled"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: action })).toBeEnabled();
  expect(finishApproval).not.toHaveBeenCalled();
});
