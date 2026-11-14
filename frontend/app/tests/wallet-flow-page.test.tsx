// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import FlowPage from "../../id/app/flow/[id]/page";
import { readFlowView } from "../../../backend/id/src/bridge/service";
import { StorageUnavailableError } from "../../../backend/id/src/near/repositories/storage-error";

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "synthetic-session" }) })) }));
vi.mock("../../../backend/id/src/bridge/service", () => ({ readFlowView: vi.fn() }));
vi.mock("../../../backend/id/src/bridge/config", () => ({ bridgeConfig: () => ({ clientOrigin: "http://localhost:3100", callback: "http://localhost:3100/api/wallet/callback" }) }));
vi.mock("../../../backend/id/src/near/services/recovery-mode", () => ({ localRecoveryEnabled: () => true, providerRecoveryEnabled: () => false }));
vi.mock("../../id/components/wallet-flow", () => ({ WalletFlow: () => null }));
afterEach(() => vi.clearAllMocks());
const view = (kind: "connect" | "approval") => ({ record: { expires: 12345, hostedFlow: { kind, connectionKind: "login", clientOrigin: "http://localhost:3100", callback: "http://localhost:3100/", status: "pending", options: { challenge: "synthetic" } } }, session: { account: null } }) as unknown as Awaited<ReturnType<typeof readFlowView>>;
const page = (screen?: string | string[]) => FlowPage({ params: Promise.resolve({ id: "synthetic-flow" }), searchParams: Promise.resolve({ screen }) });

it.each(["connect", "approval"] as const)("forwards the actual %s request deadline to the client flow", async kind => {
  vi.mocked(readFlowView).mockResolvedValue(view(kind));
  const result = await page();
  expect(result.props).toMatchObject({ id: "synthetic-flow", expiresAt: 12345, kind, recoveryEnabled: true, providerRecovery: false });
  expect(result.props.session).toEqual(kind === "connect" ? { account: null } : undefined);
  expect(readFlowView).toHaveBeenCalledWith("synthetic-flow", "synthetic-session");
});
it.each(["recover", "unknown", ["recover", "other"], undefined])("accepts only the exact recovery screen query %s", async screen => {
  vi.mocked(readFlowView).mockResolvedValue(view("connect"));
  expect((await page(screen)).props.initialScreen).toBe(screen === "recover" ? "recover" : undefined);
});
it("renders an expired flow for an unavailable request without handing out confirmation options", async () => {
  vi.mocked(readFlowView).mockRejectedValue(new Error("Unknown request"));
  expect((await page()).props).toMatchObject({ status: "expired", options: undefined });
});
it("propagates storage outages to the safe page error boundary instead of claiming expiry", async () => {
  const error = new StorageUnavailableError();
  vi.mocked(readFlowView).mockRejectedValue(error);
  await expect(page()).rejects.toBe(error);
});
