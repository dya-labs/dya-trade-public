import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WalletRecovery } from "../../id/components/wallet-recovery";
import { connectRecoveryWallet, providerRecoveryClient } from "../../id/lib/recovery-client";
const address = `0x${"ab".repeat(20)}`, signature = `0x${"12".repeat(65)}`;
const original = Object.getOwnPropertyDescriptor(window, "ethereum");
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(window, "ethereum", original);
  else Reflect.deleteProperty(window, "ethereum");
  vi.unstubAllGlobals();
});
function provider(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { eth_requestAccounts: [address], eth_chainId: "0x1", eth_accounts: [address], personal_sign: signature, ...overrides };
  const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => values[method]);
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request } });
  return { request, values };
}
it("explains missing wallet installation without attempting service recovery", async () => {
  Reflect.deleteProperty(window, "ethereum");
  await expect(connectRecoveryWallet()).rejects.toThrow("Open this page in a browser with an Ethereum wallet extension.");
});
it("uses the explicitly selected account and signs the exact UTF-8 proof only after rechecking account and chain", async () => {
  const { request } = provider({ eth_accounts: [address.toUpperCase().replace("0X", "0x")] });
  const wallet = await connectRecoveryWallet();
  expect(wallet.address).toBe(address); expect(wallet.chainId).toBe(1);
  expect(request.mock.calls.map(([input]) => input.method)).toEqual(["eth_requestAccounts", "eth_chainId"]);
  expect(await wallet.sign("DYA 🍃\nproof")).toBe(signature);
  expect(request.mock.calls.map(([input]) => input.method)).toEqual(["eth_requestAccounts", "eth_chainId", "eth_accounts", "eth_chainId", "personal_sign"]);
  expect(request).toHaveBeenLastCalledWith({ method: "personal_sign", params: ["0x44594120f09f8d830a70726f6f66", address] });
});
it.each([[], ["malformed"], null, address].map(accounts => ({ accounts })))("rejects malformed or empty wallet accounts with actionable feedback (%j)", async ({ accounts }) => {
  const { request } = provider({ eth_requestAccounts: accounts });
  await expect(connectRecoveryWallet()).rejects.toThrow("Unable to read your wallet account. Reconnect and try again.");
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "personal_sign" }));
});
it.each(["1", "0x0", "0x20000000000000", null])("rejects unsupported wallet chain identifiers without prompting a signature (%j)", async chain => {
  const { request } = provider({ eth_chainId: chain });
  await expect(connectRecoveryWallet()).rejects.toThrow("Unsupported wallet chain ID.");
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "personal_sign" }));
});
it.each(["removed", "changed", "network"])("blocks signing when the wallet is %s after connection", async change => {
  const { request, values } = provider();
  const wallet = await connectRecoveryWallet();
  if (change === "network") values.eth_chainId = "0x2105";
  else values.eth_accounts = change === "removed" ? [] : [`0x${"cd".repeat(20)}`];
  await expect(wallet.sign("synthetic proof")).rejects.toThrow("Wallet changed. Start again.");
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "personal_sign" }));
});
it.each(["bad", `0x${"12".repeat(64)}`, null])("rejects malformed signatures without exposing schema diagnostics (%j)", async result => {
  provider({ personal_sign: result });
  const wallet = await connectRecoveryWallet();
  await expect(wallet.sign("synthetic proof")).rejects.toThrow("Your wallet returned an invalid signature. Try again.");
});
it("rejects malformed account state at signing without calling personal_sign", async () => {
  const { request, values } = provider();
  const wallet = await connectRecoveryWallet(); values.eth_accounts = null;
  await expect(wallet.sign("synthetic proof")).rejects.toThrow("Unable to read your wallet account. Reconnect and try again.");
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "personal_sign" }));
});
it.each(["invalid-json-success", "invalid-json-error", "invalid-step"])("turns %s recovery responses into an actionable error", async variant => {
  const response = variant === "invalid-step" ? Response.json({ phase: 42 }) : new Response("<html>upstream unavailable</html>", { status: variant === "invalid-json-error" ? 502 : 200 });
  const fetch = vi.fn(async () => response); vi.stubGlobal("fetch", fetch);
  await expect(providerRecoveryClient.discover(address, 1)).rejects.toThrow("Recovery service returned an invalid response. Try again.");
  expect(fetch).toHaveBeenCalledOnce();
});
it("preserves a public recovery service error without advancing the workflow", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Recovery provider is unavailable. Try again." }, { status: 503 })));
  await expect(providerRecoveryClient.discover(address, 1)).rejects.toThrow("Recovery provider is unavailable. Try again.");
});
it.each(["connect", "sign"])("does not retry a rejected wallet %s request", async stage => {
  const { request, values } = provider();
  const declined = new Error("Synthetic wallet rejection");
  if (stage === "connect") {
    request.mockRejectedValueOnce(declined);
    await expect(connectRecoveryWallet()).rejects.toBe(declined);
    expect(request).toHaveBeenCalledOnce();
  } else {
    const wallet = await connectRecoveryWallet();
    request.mockImplementation(async ({ method }) => { if (method === "personal_sign") throw declined; return values[method]; });
    await expect(wallet.sign("synthetic proof")).rejects.toBe(declined);
    expect(request.mock.calls.filter(([input]) => input.method === "personal_sign")).toHaveLength(1);
  }
});
it("shows a real adapter error in recovery UI and reconnects without entering a device ceremony", async () => {
  const { request, values } = provider({ eth_requestAccounts: [] });
  render(createElement(WalletRecovery, { mode: "recover", recoveryId: "synthetic-id", onComplete: () => {}, onCancel: () => {} }));
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  expect(await screen.findByText("Unable to read your wallet account. Reconnect and try again.")).toBeVisible();
  expect(request.mock.calls.map(([input]) => input.method)).toEqual(["eth_requestAccounts"]);
  values.eth_requestAccounts = [address];
  fireEvent.click(screen.getByRole("button", { name: "Connect recovery wallet" }));
  expect(await screen.findByRole("button", { name: "Create replacement passkey" })).toBeEnabled();
  expect(screen.queryByText("Unable to read your wallet account. Reconnect and try again.")).toBeNull();
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "personal_sign" }));
});
