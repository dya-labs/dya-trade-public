import { cookies } from "next/headers";
import { localRecoveryEnabled, providerRecoveryEnabled } from "../../../../../backend/id/src/near/services/recovery-mode";
import { StorageUnavailableError } from "../../../../../backend/id/src/near/repositories/storage-error";
import { readFlowView } from "../../../../../backend/id/src/bridge/service";
import { bridgeConfig } from "../../../../../backend/id/src/bridge/config";
import { SESSION } from "../../../../../backend/id/src/near/services/workflow-context";
import { WalletFlow } from "../../../components/wallet-flow";
export const dynamic = "force-dynamic";
async function timedFlowView(id: string, session: string | undefined) {
  const started = performance.now();
  const view = await readFlowView(id, session);
  return { view, serverReadMs: Math.round(performance.now() - started) };
}
export default async function FlowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ screen?: string | string[] }> }) {
  const { id } = await params;
  const screen = (await searchParams)?.screen;
  // The account line renders with the page; the iframe needs no separate session request.
  const measured = await timedFlowView(id, (await cookies()).get(SESSION)?.value).catch(error => {
    // Let the framework render its safe error boundary for an outage.
    if (error instanceof StorageUnavailableError) throw error;
    return null;
  });
  if (!measured) { const config = bridgeConfig(); return <WalletFlow id={id} kind="approval" clientOrigin={config.clientOrigin} callback={config.callback} review={{ title: "Wallet request expired" }} options={undefined} status="expired" />; }
  const { view, serverReadMs } = measured;
  const flow = view.record.hostedFlow!;
  return <WalletFlow serverReadMs={serverReadMs} initialScreen={screen === "recover" ? "recover" : undefined} expiresAt={view.record.expires} providerRecovery={providerRecoveryEnabled()} recoveryEnabled={localRecoveryEnabled() || providerRecoveryEnabled()} id={id} kind={flow.kind} connectionKind={flow.connectionKind} clientOrigin={flow.clientOrigin} callback={flow.callback} review={flow.review} status={flow.status} options={flow.options} session={flow.kind === "connect" ? view.session : undefined} />;
}
