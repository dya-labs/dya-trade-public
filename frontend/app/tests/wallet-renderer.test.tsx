import { expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DyaProvider } from "../../../packages/wallet-react/src/index";
const mock = vi.hoisted(() => ({ preparation: undefined as undefined | ((cancel: () => void) => () => void), renderer: undefined as undefined | ((flow: {flowId:string;url:string;expires:number}, receive: (data: unknown) => void) => {destroy: () => void;showPopupBlocked: (retry: () => void) => void}) }));
vi.mock("@dya/wallet-sdk", () => ({ connect: vi.fn(), disconnect: vi.fn(), setPreparationRenderer: (renderer: typeof mock.preparation) => { mock.preparation = renderer; return () => {}; }, setDialogRenderer: (renderer: typeof mock.renderer) => { mock.renderer = renderer; return () => {}; } }));
it("keeps the host transparent and accepts readiness only from the exact wallet frame", () => {
  render(<DyaProvider><div>Terminal</div></DyaProvider>);
  const receive = vi.fn();
  act(() => { mock.renderer!({flowId:"flow",url:"http://localhost:3101/flow/flow",expires:Date.now()+60000},receive); });
  expect(screen.getByRole("status")).toHaveTextContent("Opening Dya ID");
  expect(screen.getByRole("button", {name:"Cancel"})).toBeDefined();
  const frame = screen.getByTitle("Dya ID wallet") as HTMLIFrameElement;
  expect(frame.className).toContain("h-dvh");
  expect(frame.className).toContain("invisible");
  expect(screen.getByText("Dya ID").className).toContain("sr-only");
  const message = {type:"dya:ready",flowId:"flow"};
  act(() => window.dispatchEvent(new MessageEvent("message", {origin:"https://untrusted.test",source:frame.contentWindow,data:message})));
  expect(receive).not.toHaveBeenCalled();
  expect(frame.className).toContain("invisible");
  act(() => window.dispatchEvent(new MessageEvent("message", {origin:"http://localhost:3101",source:frame.contentWindow,data:message})));
  expect(receive).toHaveBeenCalledWith(message);
  expect(frame.className.split(" ")).toContain("visible");
  expect(screen.queryByRole("status")).toBeNull();
});
it("offers an explicit blocked-popup retry and cancellation", () => {
  render(<DyaProvider><div>Terminal</div></DyaProvider>);
  const receive = vi.fn(), retry = vi.fn();
  act(() => { const handle = mock.renderer!({flowId:"flow",url:"http://localhost:3101/flow/flow",expires:Date.now()+60000},receive);handle.showPopupBlocked(retry); });
  fireEvent.click(screen.getByRole("button", {name:"Open wallet popup"}));
  expect(retry).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", {name:"Cancel"}));
  expect(receive).toHaveBeenCalledWith({type:"dya:cancel",flowId:"flow"});
});

it("shows one cancellable loading dialog before a wallet flow is available", () => {
  render(<DyaProvider><div>Terminal</div></DyaProvider>);
  const cancel = vi.fn();
  let destroy!: () => void;
  act(() => { destroy = mock.preparation!(cancel); });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Opening Dya ID");
  expect(screen.queryByTitle("Dya ID wallet")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalledOnce();
  act(() => destroy());
  expect(screen.queryByRole("status")).toBeNull();
});
