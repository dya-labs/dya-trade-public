import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { WalletTransfer } from "../../id/components/wallet-transfer";
import { StandaloneWalletContext } from "@dya/wallet-ui/components/presentation";
type FormProps = { accountId: string; onBusyChange: (busy: boolean) => void; onClose: () => void; onDetails: () => void };
function SyntheticForm({ accountId, onBusyChange, onClose, onDetails }: FormProps) {
  const standalone = useContext(StandaloneWalletContext);
  return <div><p>{accountId} · {standalone ? "standalone" : "dialog"}</p><button onClick={() => onBusyChange(true)}>Begin synthetic work</button><button onClick={() => onBusyChange(false)}>End synthetic work</button><button onClick={onClose}>Finish synthetic form</button><button onClick={onDetails}>Synthetic activity details</button></div>;
}
vi.mock("@dya/wallet-ui/components/near/transfers", () => ({ LegacyDepositForm: (props: FormProps) => <SyntheticForm {...props} /> }));
vi.mock("@dya/wallet-ui/components/near/withdrawal-form", () => ({ WithdrawalForm: (props: FormProps) => <SyntheticForm {...props} /> }));
afterEach(cleanup);
it.each(["receive", "send"] as const)("uses standalone %s flow and locks Back/account menu while busy", direction => {
  const back = vi.fn(), updated = vi.fn();
  render(<WalletTransfer direction={direction} accountId="synthetic-wallet" onBack={back} onUpdated={updated} onSignOut={vi.fn()} />);
  expect(screen.getByRole("heading", { name: direction === "receive" ? "Receive" : "Send" })).toBeInTheDocument();
  if (direction === "send") fireEvent.click(screen.getByRole("button", { name: /External/ }));
  expect(screen.getByText("synthetic-wallet · standalone")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Begin synthetic work" }));
  expect(screen.getByRole("button", { name: "Back to wallet" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Account menu" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "End synthetic work" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to wallet" }));
  if (direction === "send") {
    expect(screen.getByRole("button", { name: /External/ })).toBeVisible();
    expect(back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back to wallet" }));
  }
  expect(updated).toHaveBeenCalledTimes(direction === "send" ? 2 : 1);
  expect(back).toHaveBeenCalledOnce();
  expect(updated.mock.invocationCallOrder[0]).toBeLessThan(back.mock.invocationCallOrder[0]);
});
it.each(["Finish synthetic form", "Synthetic activity details"])("refreshes and returns from %s", action => {
  const back = vi.fn(), updated = vi.fn();
  render(<WalletTransfer direction="receive" accountId="synthetic-wallet" onBack={back} onUpdated={updated} onSignOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: action }));
  expect(updated).toHaveBeenCalledOnce(); expect(back).toHaveBeenCalledOnce();
});
it("routes the page-header sign-out menu to the parent confirmation", async () => {
  const signOut = vi.fn();
  render(<WalletTransfer direction="send" accountId="synthetic-wallet" onBack={vi.fn()} onUpdated={vi.fn()} onSignOut={signOut} />);
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalledOnce();
});
