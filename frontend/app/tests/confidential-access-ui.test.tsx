import { toast } from "@dya/ui/lib/toast";
vi.mock("@dya/ui/lib/toast", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfidentialAccess } from "@/components/near/confidential-access";
import { prepareConfidentialAccess, unlockConfidentialAccess } from "@dya/wallet-ui/lib/near/http/confidential-client";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
import { startAuthentication } from "@dya/wallet-sdk";
vi.mock("@dya/wallet-ui/lib/near/http/confidential-client", () => ({ prepareConfidentialAccess: vi.fn(), unlockConfidentialAccess: vi.fn() }));
vi.mock("@dya/wallet-sdk", () => ({ startAuthentication: vi.fn(), connect: vi.fn() }));
let client: QueryClient;
const privateKey = ["near", "account", "synthetic-unlock", "balances"];
const publicKey = ["near", "catalog"];
function mount(panel = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(privateKey, { synthetic: true });
  client.setQueryData(publicKey, { assets: [] });
  render(<QueryClientProvider client={client}><ConfidentialAccess panel={panel} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prepareConfidentialAccess).mockResolvedValue({ options: { challenge: "synthetic-unlock" } } as Awaited<ReturnType<typeof prepareConfidentialAccess>>);
  vi.mocked(startAuthentication).mockResolvedValue({ id: "synthetic-assertion" } as Awaited<ReturnType<typeof startAuthentication>>);
  vi.mocked(unlockConfidentialAccess).mockResolvedValue({ unlocked: true });
});
afterEach(() => { cleanup(); client.clear(); });
it("refreshes only private account queries after a verified unlock and reports restored access", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Balance access restored.");
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "synthetic-unlock" } });
  expect(unlockConfidentialAccess).toHaveBeenCalledWith({ id: "synthetic-assertion" });
  expect(client.getQueryState(privateKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(publicKey)?.isInvalidated).toBe(false);
});
it.each([false, true])("locks duplicate unlocks and shows a spinner while approval is pending (panel=%s)", async panel => {
  let approve!: (value: Awaited<ReturnType<typeof startAuthentication>>) => void;
  vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(resolve => { approve = resolve; }));
  mount(panel);
  fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  const pending = await screen.findByRole("button", { name: "Checking…" });
  expect(pending).toBeDisabled();
  expect(pending.querySelector(".dya-spinner")).not.toBeNull();
  fireEvent.click(pending);
  expect(prepareConfidentialAccess).toHaveBeenCalledOnce();
  expect(unlockConfidentialAccess).not.toHaveBeenCalled();
  expect(client.getQueryState(privateKey)?.isInvalidated).toBe(false);
  await act(async () => approve({ id: "synthetic-assertion" } as Awaited<ReturnType<typeof startAuthentication>>));
  await screen.findByText("Balance access restored.");
});
it.each(["NotAllowedError", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"])("shows %s cancellation as a neutral toast with a retryable action without refreshing balances", async code => {
  vi.mocked(startAuthentication).mockRejectedValueOnce(code === "NotAllowedError" ? new DOMException("Opaque browser diagnostic", code) : { code, message: "Opaque SDK diagnostic" });
  mount(true);
  fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Confirmation cancelled"));
  expect(screen.queryByRole("alert")).toBeNull();
  const retry = screen.getByRole("button", { name: "Unlock balances" });
  expect(retry).toBeEnabled();
  expect(unlockConfidentialAccess).not.toHaveBeenCalled();
  expect(client.getQueryState(privateKey)?.isInvalidated).toBe(false);
  expect(screen.queryByText(/Opaque/)).toBeNull();
  fireEvent.click(retry);
  expect(await screen.findByText("Balance access restored.")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});
it.each(["prepare", "verify"])("keeps %s failure actionable without claiming restored access", async stage => {
  vi.mocked(stage === "prepare" ? prepareConfidentialAccess : unlockConfidentialAccess).mockRejectedValueOnce(new Error("Synthetic unlock unavailable"));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic unlock unavailable");
  expect(screen.queryByText("Balance access restored.")).toBeNull();
  expect(client.getQueryState(privateKey)?.isInvalidated).toBe(false);
  if (stage === "prepare") expect(startAuthentication).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  await waitFor(() => expect(client.getQueryState(privateKey)?.isInvalidated).toBe(true));
});

function mountActiveBalance(read: () => Promise<{ synthetic: boolean }>) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function ObservedAccess() {
    useQuery({ queryKey: privateKey, queryFn: read, initialData: { synthetic: true }, staleTime: Infinity });
    return <ConfidentialAccess />;
  }
  render(<QueryClientProvider client={client}><ObservedAccess /></QueryClientProvider>);
}
it("does not claim restored access while active balance reads still require authorization", async () => {
  const error = new ConfidentialAccessRequired();const read = vi.fn().mockRejectedValue(error);mountActiveBalance(read);
  fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(error.message);
  expect(screen.queryByText("Balance access restored.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Unlock balances" })).toBeEnabled();
  read.mockResolvedValue({ synthetic: true });fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Balance access restored.");expect(startAuthentication).toHaveBeenCalledTimes(2);
});
it("retries balance refresh without another signature after confirmed access and a temporary read failure", async () => {
  const read = vi.fn().mockRejectedValue(new Error("Synthetic balance read unavailable"));mountActiveBalance(read);
  fireEvent.click(screen.getByRole("button", { name: "Unlock balances" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic balance read unavailable");
  expect(screen.queryByText("Balance access restored.")).not.toBeInTheDocument();
  read.mockResolvedValue({ synthetic: true });fireEvent.click(screen.getByRole("button", { name: "Retry balances" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Balance access restored.");expect(startAuthentication).toHaveBeenCalledTimes(1);expect(unlockConfidentialAccess).toHaveBeenCalledTimes(1);
});
