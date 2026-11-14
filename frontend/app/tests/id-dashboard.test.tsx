import { afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WalletDashboard } from "../../id/components/wallet-dashboard";

import { DEFAULT_PAIR } from "@dya/wallet-contracts/src/domain/catalog";
const mock = vi.hoisted(() => ({ request: vi.fn(), authenticate: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/request", () => ({ request: mock.request }));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: mock.authenticate, startRegistration: vi.fn() }));
// Image stand-in for jsdom.
vi.mock("next/image", () => ({ default: (props: {src:string;alt:string}) => <img src={props.src} alt={props.alt} /> }));
afterEach(() => { vi.resetAllMocks(); });
it("offers account creation and sign-in without a terminal connection", async () => {
  mock.request.mockResolvedValue({ account: null, passkeyOrigin: 'https://id.example.test' });
  render(<WalletDashboard />);
  expect(await screen.findByRole('button', {name:'Sign in'})).toBeEnabled();
  expect(screen.getByRole('button', {name:'Create account'})).toBeEnabled();
});
it("does not show locked balances as zero and offers confidential unlock", async () => {
  const {ConfidentialAccessRequired} = await import("@dya/wallet-contracts/src/domain/confidential-access-error");
  mock.request.mockImplementation((path:string) => {
    if (path === 'state') return Promise.resolve({ account: {id:'wallet',kind:'passkey'},passkeyOrigin:'https://id.example.test' });
    if (path === 'catalog') return Promise.resolve({assets:[DEFAULT_PAIR.quote]});
    if (path.startsWith('live/balances')) return Promise.reject(new ConfidentialAccessRequired('Unlock'));
    return Promise.resolve({withdrawals:[],deposits:[]});
  });
  render(<WalletDashboard />);
  expect(await screen.findByRole('button',{name:'Unlock balances'})).toBeEnabled();
  expect(screen.queryByText('$0.00')).toBeNull();
});
it("asks before signing out and cancellation preserves the session", async () => {
  mock.request.mockImplementation((path:string) => {
    if (path === 'state') return Promise.resolve({account:{id:'wallet',kind:'passkey'},passkeyOrigin:'https://id.example.test'});
    if (path === 'catalog') return Promise.resolve({assets:[DEFAULT_PAIR.quote]});
    if (path.startsWith('live/balances')) return Promise.resolve({assets:[],accountId:'wallet',blockHeight:0,checkedAt:1});
    return Promise.resolve({withdrawals:[],deposits:[],ok:true});
  });
  render(<WalletDashboard />);
  fireEvent.click(await screen.findByRole('button',{name:'Settings'}));
  fireEvent.click(await screen.findByRole('menuitem',{name:'Sign out'}));
  expect(await screen.findByRole('alertdialog',{name:'Sign out?'})).toBeVisible();
  expect(mock.request.mock.calls.some(([path])=>path==='auth/logout')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(mock.request.mock.calls.some(([path])=>path==='auth/logout')).toBe(false);
});

it("moves recovery setup off Home and exposes its dedicated page from the account menu", async () => {
  mock.request.mockImplementation((path: string) => {
    if (path === "state") return Promise.resolve({ account: { id: "wallet", kind: "passkey" }, recoveryMode: "provider", passkeyOrigin: "https://id.example.test" });
    if (path === "catalog") return Promise.resolve({ assets: [DEFAULT_PAIR.quote] });
    if (path.startsWith("live/balances")) return Promise.resolve({ assets: [], accountId: "wallet", blockHeight: 0, checkedAt: 1 });
    return Promise.resolve({ withdrawals: [], deposits: [], trades: [], operations: [] });
  });
  const home = render(<WalletDashboard />);
  fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("menuitem", { name: "Recovery wallet" })).toHaveAttribute("href", "/recovery");
  expect(screen.queryByRole("button", { name: "Add recovery wallet" })).toBeNull();
  home.unmount();
  render(<WalletDashboard view="recovery" />);
  expect(await screen.findByRole("heading", { name: "Recovery wallet", level: 1 })).toBeVisible();
  expect(screen.getByRole("button", { name: "Back to wallet" })).toHaveAttribute("href", "/");
  expect(await screen.findByRole("button", { name: "Add recovery wallet" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: "Balance" })).toBeNull();
});
