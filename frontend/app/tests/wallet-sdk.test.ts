import { afterEach, beforeEach, expect, it, vi } from "vitest";
let message: (data: { type: string; flowId: string; code?: string; screen?: string }) => void;
const flow = { flowId: "f".repeat(43), url: "http://localhost:3101/flow/test", expires: 0 };
let popupMessage: (event: { origin: string; source: unknown; data: unknown }) => void;
const popup = { document: { title: "", body: { textContent: "" } }, location: { replace: vi.fn() }, closed: false, close: vi.fn(), focus: vi.fn() };
const open = vi.fn();
const navigate = vi.fn(), cleanup = vi.fn(), fetcher = vi.fn();
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  flow.expires = Date.now() + 60000;
  popup.closed = false; open.mockReturnValue(popup);
  vi.stubGlobal("navigator", { userAgent: "Desktop Chrome", platform: "MacIntel", maxTouchPoints: 0 });
  vi.stubGlobal("window", { location: { assign: navigate }, open, screenX: 0, screenY: 0, innerWidth: 1280, addEventListener: (_name: string, fn: typeof popupMessage) => { popupMessage = fn; }, removeEventListener: vi.fn() });
  fetcher.mockResolvedValue({ ok: true, json: async () => flow }); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function sdk() {
  const sdk = await import("../../../packages/wallet-sdk/src/index");
  sdk.setDialogRenderer((_flow, receive) => { message = receive; return cleanup; });
  return sdk;
}
it("exchanges connection codes once and ignores unrelated flow messages", async () => {
  const wallet = await sdk(), pending = wallet.connect();
  await vi.advanceTimersByTimeAsync(0);
  message({ type: "dya:complete", flowId: "other", code: "wrong" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  message({ type: "dya:complete", flowId: flow.flowId, code: "code" });
  await pending;
  expect(fetcher).toHaveBeenCalledTimes(2); expect(cleanup).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled();
});
it("cancels explicitly without navigating to the wallet site", async () => {
  const wallet = await sdk(), pending = wallet.connect();
  const rejected = expect(pending).rejects.toMatchObject({ name: "NotAllowedError" });
  await vi.advanceTimersByTimeAsync(0); message({ type: "dya:cancel", flowId: flow.flowId }); await rejected;
  expect(navigate).not.toHaveBeenCalled(); expect(cleanup).toHaveBeenCalledOnce();
});
it("opens a desktop popup when the frame does not become ready without navigating Terminal", async () => {
  const wallet = await sdk(); void wallet.connect();
  await vi.advanceTimersByTimeAsync(8000);
  expect(open).toHaveBeenCalledWith(flow.url, "_blank", expect.stringContaining("popup=yes")); expect(navigate).not.toHaveBeenCalled(); expect(cleanup).toHaveBeenCalledOnce();
});
it("returns only an opaque approval receipt, without exposing a signing assertion", async () => {
  const wallet = await sdk(), pending = wallet.startAuthentication({ optionsJSON: { challenge: "challenge" } });
  await vi.advanceTimersByTimeAsync(0); message({ type: "dya:ready", flowId: flow.flowId });
  message({ type: "dya:complete", flowId: flow.flowId });
  expect(await pending).toEqual({ id: flow.flowId, dyaApproval: flow.flowId }); expect(fetcher).toHaveBeenCalledOnce();
});
it("opens a flow the server already created without requesting another", async () => {
  const wallet = await sdk(), pending = wallet.startAuthentication({ optionsJSON: { challenge: "challenge" }, flow });
  await vi.advanceTimersByTimeAsync(0); message({ type: "dya:ready", flowId: flow.flowId });
  message({ type: "dya:complete", flowId: flow.flowId });
  expect(await pending).toEqual({ id: flow.flowId, dyaApproval: flow.flowId }); expect(fetcher).not.toHaveBeenCalled();
});

it("validates popup origin and source, exchanges once, and closes the popup on completion", async () => {
  const wallet = await sdk(), pending = wallet.connect();
  await vi.advanceTimersByTimeAsync(0); message({ type: "dya:fallback", flowId: flow.flowId });
  popupMessage({ origin: "https://other.example", source: popup, data: { type: "dya:complete", flowId: flow.flowId, code: "wrong" } });
  popupMessage({ origin: "http://localhost:3101", source: {}, data: { type: "dya:complete", flowId: flow.flowId, code: "wrong" } });
  expect(fetcher).toHaveBeenCalledOnce();
  popupMessage({ origin: "http://localhost:3101", source: popup, data: { type: "dya:complete", flowId: flow.flowId, code: "code" } });
  await pending; expect(fetcher).toHaveBeenCalledTimes(2); expect(popup.close).toHaveBeenCalledOnce();
});
it("treats closing the popup as explicit cancellation", async () => {
  const wallet = await sdk(), pending = wallet.connect();
  const rejected = expect(pending).rejects.toMatchObject({ name: "NotAllowedError" });
  await vi.advanceTimersByTimeAsync(0); message({ type: "dya:fallback", flowId: flow.flowId });
  popup.closed = true; await vi.advanceTimersByTimeAsync(100); await rejected;
  expect(navigate).not.toHaveBeenCalled();
});
it("opens a mobile tab without desktop popup dimensions", async () => {
  vi.stubGlobal("navigator", { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 });
  const wallet = await sdk(); void wallet.connect(); await vi.advanceTimersByTimeAsync(0);
  message({ type: "dya:fallback", flowId: flow.flowId });
  expect(open).toHaveBeenCalledWith(flow.url, "_blank", undefined);
});
it("offers a user-gesture retry when a popup is blocked", async () => {
  const wallet = await import("../../../packages/wallet-sdk/src/index");
  let retry: (() => void) | undefined;
  wallet.setDialogRenderer((_flow, receive) => { message = receive; return { destroy: cleanup, showPopupBlocked: fn => { retry = fn; } }; });
  open.mockReturnValueOnce(null); void wallet.connect(); await vi.advanceTimersByTimeAsync(0);
  message({ type: "dya:fallback", flowId: flow.flowId });
  expect(retry).toBeTypeOf("function"); expect(cleanup).not.toHaveBeenCalled();
  retry!(); expect(open).toHaveBeenCalledTimes(2); expect(cleanup).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled();
});

it("preserves Recover screen through fallback and blocked-popup retry", async () => {
  const wallet = await import("../../../packages/wallet-sdk/src/index");
  let retry!: () => void;
  wallet.setDialogRenderer((_flow, receive) => { message = receive; return { destroy: cleanup, showPopupBlocked: fn => { retry = fn; } }; });
  open.mockReturnValueOnce(null);
  const pending = wallet.connect();const cancelled = expect(pending).rejects.toMatchObject({ name: "NotAllowedError" });
  await vi.advanceTimersByTimeAsync(0);
  message({ type: "dya:fallback", flowId: flow.flowId, screen: "recover" });
  expect(open).toHaveBeenLastCalledWith(flow.url + "?screen=recover", "_blank", expect.any(String));
  retry();expect(open).toHaveBeenLastCalledWith(flow.url + "?screen=recover", "_blank", expect.any(String));
  popupMessage({ origin: "http://localhost:3101", source: popup, data: { type: "dya:cancel", flowId: flow.flowId } });await cancelled;
});

it("ignores unknown fallback screen hints", async () => {
  const wallet = await sdk(), pending = wallet.connect();const cancelled = expect(pending).rejects.toMatchObject({ name: "NotAllowedError" });
  await vi.advanceTimersByTimeAsync(0);message({ type: "dya:fallback", flowId: flow.flowId, screen: "https://untrusted.invalid" });
  expect(open).toHaveBeenCalledWith(flow.url, "_blank", expect.any(String));
  popupMessage({ origin: "http://localhost:3101", source: popup, data: { type: "dya:cancel", flowId: flow.flowId } });await cancelled;
});

it("opens connection directly in a popup for Safari rather than attempting iframe creation", async () => {
  vi.stubGlobal("navigator", { userAgent: "Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 });
  const wallet = await sdk(); void wallet.connect();
  await vi.advanceTimersByTimeAsync(0);
  expect(open).toHaveBeenCalledWith("about:blank", "_blank", expect.stringContaining("popup=yes"));
  expect(popup.location.replace).toHaveBeenCalledWith(flow.url);
});

it("shows loading before flow creation finishes and cleans it up on failure", async () => {
  const wallet = await sdk();
  const destroyed = vi.fn(), loading = vi.fn(() => destroyed);
  wallet.setPreparationRenderer(loading);
  let reject!: (error: Error) => void;
  fetcher.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = wallet.connect();
  expect(loading).toHaveBeenCalledOnce();
  const rejected = expect(pending).rejects.toThrow("Unavailable");
  reject(new Error("Unavailable"));
  await rejected;
  expect(destroyed).toHaveBeenCalled();
});

it("reserves Safari's popup synchronously before flow creation finishes", async () => {
  vi.stubGlobal("navigator", { userAgent: "Version/18.0 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 });
  const wallet = await sdk();
  let resolve!: (value: unknown) => void;
  fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = wallet.connect();
  expect(open).toHaveBeenCalledWith("about:blank", "_blank", expect.stringContaining("popup=yes"));
  expect(popup.location.replace).not.toHaveBeenCalled();
  resolve({ ok: true, json: async () => flow });
  await vi.advanceTimersByTimeAsync(0);
  popupMessage({ origin: "http://localhost:3101", source: popup, data: { type: "dya:complete", flowId: flow.flowId, code: "code" } });
  await pending;
  expect(popup.location.replace).toHaveBeenCalledWith(flow.url);
});

it("expires an embedded flow, ignores late completion and permits a fresh request", async () => {
  const wallet = await sdk(), pending = wallet.connect();
  const expired = expect(pending).rejects.toThrow("Wallet request expired");
  await vi.advanceTimersByTimeAsync(0);
  const oldMessage = message;
  message({ type: "dya:ready", flowId: flow.flowId });
  await vi.advanceTimersByTimeAsync(60000);
  await expired;
  expect(cleanup).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  oldMessage({ type: "dya:complete", flowId: flow.flowId, code: "late-code" });
  expect(fetcher).toHaveBeenCalledOnce();
  flow.expires = Date.now() + 60000;
  const fresh = wallet.connect();
  const cancelled = expect(fresh).rejects.toMatchObject({ name: "NotAllowedError" });
  await vi.advanceTimersByTimeAsync(0);
  message({ type: "dya:cancel", flowId: flow.flowId });
  await cancelled;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(navigate).not.toHaveBeenCalled();
});

it("closes an expired fallback popup and removes its message listener and timers", async () => {
  const wallet = await sdk(), pending = wallet.connect();
  const expired = expect(pending).rejects.toThrow("Wallet request expired");
  await vi.advanceTimersByTimeAsync(8000);
  expect(open).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(52000);
  await expired;
  expect(popup.close).toHaveBeenCalledOnce();
  expect(window.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
  popupMessage({ origin: "http://localhost:3101", source: popup, data: { type: "dya:complete", flowId: flow.flowId, code: "late-code" } });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
});

it.each([undefined, '', '   '])('rejects connection completion with missing or empty code %s and permits a fresh retry', async code => {
  const wallet = await sdk(), pending = wallet.connect();
  const rejected = expect(pending).rejects.toThrow('Wallet connection wasn’t completed');
  await vi.advanceTimersByTimeAsync(0);
  message({ type: 'dya:complete', flowId: flow.flowId, code });
  await rejected;
  expect(fetcher).toHaveBeenCalledOnce();expect(cleanup).toHaveBeenCalledOnce();
  const retry = wallet.connect();
  await vi.advanceTimersByTimeAsync(0);
  message({ type: 'dya:complete', flowId: flow.flowId, code: 'fresh-code' });
  await retry;
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher).toHaveBeenLastCalledWith('/api/wallet/exchange', expect.objectContaining({ body: JSON.stringify({ flowId: flow.flowId, code: 'fresh-code' }) }));
  expect(cleanup).toHaveBeenCalledTimes(2);expect(navigate).not.toHaveBeenCalled();
});

it.each(['success', 'failure'] as const)('keeps a fresh connection protected when an expired exchange finishes with %s', async outcome => {
  const exchange = Promise.withResolvers<{ ok: boolean; json: () => Promise<unknown> }>();
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => flow }).mockReturnValueOnce(exchange.promise);
  const wallet = await sdk(), pending = wallet.connect();
  const expired = expect(pending).rejects.toThrow('Wallet request expired');
  await vi.advanceTimersByTimeAsync(0);message({ type: 'dya:ready', flowId: flow.flowId });
  message({ type: 'dya:complete', flowId: flow.flowId, code: 'old-code' });
  await vi.advanceTimersByTimeAsync(0);
  const exchangeSignal = fetcher.mock.calls[1][1].signal as AbortSignal | undefined;
  await vi.advanceTimersByTimeAsync(60000);await expired;
  expect(cleanup).toHaveBeenCalledOnce();
  flow.expires = Date.now() + 60000;
  const fresh = wallet.connect(), cancelled = expect(fresh).rejects.toMatchObject({ name: 'NotAllowedError' });
  await vi.advanceTimersByTimeAsync(0);message({ type: 'dya:ready', flowId: flow.flowId });
  if (outcome === 'success') exchange.resolve({ ok: true, json: async () => ({ ok: true }) });else exchange.reject(new Error('Late old exchange failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(cleanup).toHaveBeenCalledOnce();
  fetcher.mockRejectedValue(new Error('Unexpected overlapping flow request'));
  await expect(wallet.connect()).rejects.toThrow('Complete the current wallet request first.');
  expect(exchangeSignal?.aborted).toBe(true);
  message({ type: 'dya:cancel', flowId: flow.flowId });await cancelled;
  expect(cleanup).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);expect(navigate).not.toHaveBeenCalled();
});

it("closes expired quote recovery without producing an approval receipt or navigating Terminal", async () => {
 const wallet = await sdk(), pending = wallet.startAuthentication({optionsJSON:{challenge:"quote"}});
 const rejected = expect(pending).rejects.toMatchObject({name:"WalletQuoteExpiredError"});
 await vi.advanceTimersByTimeAsync(0);
 message({type:"dya:retry",flowId:flow.flowId});
 await rejected;
 expect(fetcher).toHaveBeenCalledOnce();
 expect(cleanup).toHaveBeenCalledOnce();
 expect(navigate).not.toHaveBeenCalled();
});

it("reports popup lifecycle only when a separate window opens, then clears it on completion", async () => {
  const wallet = await sdk(), onPresentationChange = vi.fn();
  const pending = wallet.connect("login", {onPresentationChange});
  await vi.advanceTimersByTimeAsync(0);
  expect(onPresentationChange.mock.calls).toEqual([["dialog"]]);
  message({ type:"dya:fallback", flowId:flow.flowId });
  expect(onPresentationChange.mock.calls).toEqual([["dialog"],["popup"]]);
  popupMessage({ origin:"http://localhost:3101", source:popup, data:{type:"dya:complete",flowId:flow.flowId,code:"code"} });
  await pending;
  expect(onPresentationChange.mock.calls).toEqual([["dialog"],["popup"],[null]]);
});
it("reports popup closure during pending confirmation", async () => {
  const wallet = await sdk(), onPresentationChange = vi.fn();
  const pending = wallet.connect("login", {onPresentationChange});
  const rejected = expect(pending).rejects.toMatchObject({name:"NotAllowedError"});
  await vi.advanceTimersByTimeAsync(0);
  message({type:"dya:fallback",flowId:flow.flowId});
  popup.closed = true;
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(onPresentationChange.mock.calls).toEqual([["dialog"],["popup"],[null]]);
});
it("clears reserved-popup guidance if flow creation fails", async () => {
  vi.stubGlobal("navigator",{userAgent:"Safari",platform:"MacIntel",maxTouchPoints:0});
  fetcher.mockRejectedValueOnce(new Error("Offline"));
  const wallet = await sdk(), onPresentationChange = vi.fn();
  await expect(wallet.connect("login", {onPresentationChange})).rejects.toThrow("Offline");
  expect(onPresentationChange.mock.calls).toEqual([["popup"],[null]]);
  expect(popup.close).toHaveBeenCalled();
});

it("measures only readiness for the active flow and logs no flow identifiers", async () => {
  const log = vi.spyOn(console, "debug").mockImplementation(() => {});
  try {
    const wallet = await sdk();
    const pending = wallet.startAuthentication({ optionsJSON: { challenge: "private-challenge" } });
    const rejected = expect(pending).rejects.toMatchObject({ name: "NotAllowedError" });
    await vi.advanceTimersByTimeAsync(0);
    message({ type: "dya:ready", flowId: "wrong" });
    expect(log.mock.calls.filter(([, data]) => JSON.parse(data as string).event === "ready")).toHaveLength(0);
    message({ type: "dya:ready", flowId: flow.flowId });
    message({ type: "dya:ready", flowId: flow.flowId });
    const ready = log.mock.calls.filter(([, data]) => JSON.parse(data as string).event === "ready");
    expect(ready).toHaveLength(1);
    expect(JSON.parse(ready[0][1] as string)).toMatchObject({ operation: "approval", mode: "dialog", totalMs: expect.any(Number), flowMs: expect.any(Number), screenMs: expect.any(Number) });
    expect(JSON.stringify(log.mock.calls)).not.toContain(flow.flowId);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-challenge");
    message({ type: "dya:cancel", flowId: flow.flowId });
    await rejected;
  } finally { log.mockRestore(); }
});
