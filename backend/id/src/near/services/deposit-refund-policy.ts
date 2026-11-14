import type { State } from "../repositories/store";
import { validNetworkRefundAddress } from "../../../../../packages/wallet-contracts/src/domain/refund-security";
import { networkAllowed, type Network } from "../../../../../packages/wallet-contracts/src/domain/networks";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";

/** No hardcoded fallback: a configured address must match the reviewed network's chain ID. */
export function configuredDepositRefund(s: State, network: Network | undefined): string | undefined {
  if (!network || (network.addressKind === "evm" && !network.evmChainId)) return undefined;
  const setting = s.accessRecords?.[`refund:${network.id}`];
  return setting?.kind === "refund-setting" && setting.networkId === network.id && setting.chainId === (network.evmChainId ?? undefined) && (setting.addressKind === network.addressKind || (setting.addressKind === undefined && network.addressKind === "evm")) && validNetworkRefundAddress(network, setting.address) ? setting.address : undefined;
}
export function depositNetworkAllowed(s: State, network: Network | undefined) {
  return networkAllowed(network, "deposits") && !!configuredDepositRefund(s, network);
}
export function requireDepositRefund(s: State, networkId: string) {
  const network = s.networks?.[networkId], address = configuredDepositRefund(s, network);
  if (!networkAllowed(network, "deposits") || !address) throw new AppError(ErrorCode.NetworkTransferUnavailable);
  return address;
}
export function depositRefundStatus(s: State, network: Network) {
  if (configuredDepositRefund(s, network)) return networkAllowed(network, "deposits") ? "active" : "configured";
  const record = s.accessRecords?.[`refund:${network.id}`];
  return record?.kind === "refund-setting" && record.address ? "needs_review" : "not_configured";
}
