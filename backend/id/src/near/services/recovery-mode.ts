import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { getDeploymentConfig } from "../../deployment/config";

/** The simulator is deliberately unavailable on hosted origins, even with the flag set. */
export function localRecoveryEnabled() {
  const config = getDeploymentConfig();
  return !config.hosted && process.env.DYA_ID_LOCAL_RECOVERY === "1" && !providerRecoveryEnabled();
}
export const LOCAL_RECOVERY_NOTICE = "Local recovery test account. Wallet authority is simulated; live balances, deposits, and transactions are disabled.";

export class LocalRecoveryRestricted extends Error {
  constructor() { super(LOCAL_RECOVERY_NOTICE); this.name = "LocalRecoveryRestricted"; }
}

export function providerRecoveryEnabled() {
  return process.env.DYA_ID_PROVIDER_RECOVERY === "1" && !!process.env.ONE_CLICK_JWT && /^[a-fA-F0-9]{64}$/.test(process.env.CONFIDENTIAL_SESSION_KEY ?? "");
}

export function assertRecoverySigningAvailable(account: import("../../../../../packages/wallet-contracts/src/domain/state").Account) {
  const op = account.providerRecovery?.operation;
  if (op?.kind === "recover" && !["complete", "rejected"].includes(op.phase)) throw new AppError(ErrorCode.WalletRecoveryIsInProgress);
}
