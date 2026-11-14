import type { ConsolidationOperation, PreparedConsolidation } from "../http/schemas/consolidation";
import type { StoredOrder } from "../../../../backend/id/src/near/services/orders";
import type { AuthenticatorTransport } from "@simplewebauthn/server";
import type { SigningCheck } from "../../../../backend/id/src/near/auth/intents";
import type { ExecutableMarketQuote, ExecutableMarketTrade } from "../../../../backend/id/src/near/services/market-execution";
import type { WithdrawalReview } from "../../../../backend/id/src/near/services/one-click-withdraw";
import type { DepositQuote, DepositStatus } from "../../../../backend/id/src/near/services/one-click-deposit";
import type { FundingReview } from "../../../../backend/id/src/near/services/funding";

export interface BackupPasskey {
  id: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  testedAt?: number;
  status: "pending_onchain";
}
export interface ProviderRecoveryOperation {
  id: string;
  kind: "enroll" | "recover";
  phase: "enroll_key" | "enroll_pending" | "enroll_auth" | "recover_add" | "recover_add_pending" | "recover_test" | "recover_remove" | "recover_remove_pending" | "recover_finish" | "complete" | "rejected";
  outcome?: "submitted" | "unknown" | "rejected";
  sourceCredentialId: string;
  sourcePublicKey: string;
  revision: number;
  controllerAddress: `0x${string}`;
  controllerKey: string;
  chainId: number;
  payload?: string;
  intentHash?: string;
  pendingCredential?: { id: string; publicKey: string; counter: number; transports?: AuthenticatorTransport[] };
  revokedKeys: string[];
  createdAt: number;
}
export interface ProviderRecovery {
  revision: number;
  controller?: { address: `0x${string}`; publicKey: string; chainId: number; verifiedAt: number; status: "ready" };
  operation?: ProviderRecoveryOperation;
}
export interface Account {
  outlayerLegacySetup?: import("../../../../backend/id/src/near/outlayer/accounts").SetupPreferences;
  outlayerTradingAccounts?: Record<string, import("../../../../backend/id/src/near/outlayer/accounts").TradingAccountRecord>;
  outlayerActivationHistory?: Record<string, import("../../../../backend/id/src/near/outlayer/activation-state").ActivationOperation>;
  outlayerActivation?: import("../../../../backend/id/src/near/outlayer/activation-state").ActivationOperation;
  outlayerRecovery?: import("./outlayer-setup").OutlayerRecoveryPasskey;
  outlayerSetupDraft?: import("./outlayer-setup").OutlayerSetupDraft;
  outlayerOwnerCheck?: import("./outlayer-setup").OutlayerOwnerCheck;
  fundingBatches?: Record<string, import("../../../../backend/id/src/near/services/funding-conversions").StoredFundingBatch>;
  consolidations?: Record<string, ConsolidationOperation>;
  /** Permanent fence: these accounts must never invoke live wallet providers. */
  providerRecovery?: ProviderRecovery;
  localRecovery?: { originalIdentity: { accountId: string; publicKey: string }; revision: number };
  recoveryWallet?: { address: `0x${string}`; chainId: number; enrolledAt: number; status: "local_test" };
  backupEnrollmentUntil?: number;
  backup?: BackupPasskey;
  intentsAccountId?: string;
  id: string;
  kind: "passkey";
  /** Private display label; never part of a public wallet identity. */
  name?: string;
  credentialId?: string;
  publicKey?: string;
  counter?: number;
  transports?: AuthenticatorTransport[];
  signingCheck?: SigningCheck;
}
export interface LiveTrade {
  execution?: { inputRaw: string; outputRaw: string; inputAmount: string; outputAmount: string; settledAt: number };
  nearTxHashes?: string[];
  id: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  state: "signing" | "submitted" | "unknown" | "settled" | "failed";
  review: ExecutableMarketTrade;
  intentHash?: string;
}
export interface Deposit {
  id: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  quote: DepositQuote;
  status: DepositStatus["status"] | "PENDING_DEPOSIT";
  /** Amount 1Click reports as credited once the deposit succeeds. */
  creditedAmount?: string;
  originChainTxHashes?: string[];
  destinationChainTxHashes?: string[];
}
export interface Withdrawal {
  id: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  state: "signing" | "submitted" | "unknown" | "settled" | "failed";
  review: WithdrawalReview;
  intentHash?: string;
  originChainTxHashes?: string[];
  destinationChainTxHashes?: string[];
}
export interface HostedFlow {
  connectionKind?: "login" | "register";
  kind: "connect" | "approval";
  clientOrigin: string;
  callback: string;
  verifierHash: string;
  session?: string;
  ceremony?: string;
  submitRoute?: string;
  options?: unknown;
  review?: unknown;
  status: "pending" | "running" | "complete";
  codeHash?: string;
  result?: { status: number; body: unknown };
}
export interface Challenge {
  outlayerWithdrawalReview?: { asset: string; amount: string; estimatedReceive: string; recipient: string; network: string; expires: string };
  outlayerPolicyExecution?: { walletId: string; requestId: string; sessionHash: string; message: import("../../../../backend/id/src/near/outlayer/owner-request").OwnerRequest; gasPriceCap: string };
  outlayerSendPolicy?: { walletId: string; withdrawalId?: string; requestId: string; sessionHash: string; message: import("../../../../backend/id/src/near/outlayer/owner-request").ControllerApproval };
  outlayerActivation?: { id: string; planHash: string; sessionHash: string; ownerRequest?: import("../../../../backend/id/src/near/outlayer/owner-request").OwnerRequest };
  outlayerRecovery?: import("./outlayer-setup").OutlayerRecoveryEnrollment;
  outlayerOwner?: { controllerId: string; codeHash: string; publicKey: string; credentialId: string; sessionHash: string };
  providerDiscovery?: { address: `0x${string}`; chainId: number; message: string; accountIds?: string[] };
  providerDraft?: ProviderRecoveryOperation;
  providerPhase?: string;
  providerOperationId?: string;
  providerProofExpires?: number;
  recovery?: {
    proof?: import("../../../../backend/id/src/near/auth/recovery-wallet").RecoveryChallenge;
    address: `0x${string}`;
    chainId: number;
    revision: number;
    credentialId: string;
    publicKey: string;
    pendingCredential?: { id: string; publicKey: string; counter: number; transports?: AuthenticatorTransport[] };
  };
  hostedFlow?: HostedFlow;
  hostedOptions?: unknown;
  value: string;
  fundingBatchId?: string;
  fundingLegId?: string;
  consolidation?: PreparedConsolidation;
  purpose: "outlayer-policy-execution" | "outlayer-send-policy" | "outlayer-withdrawal" | "outlayer-payment" | "outlayer-activation-owner" | "outlayer-recovery" | "outlayer-owner" | "provider-recovery" | "recovery-authorize" | "recovery-enroll" | "recovery-register" | "recovery-complete" | "hosted-flow" | "funding-conversion" | "confidential-auth" | "consolidation" | "register" | "login" | "order" | "intents" | "market-trade" | "market-quote" | "withdraw" | "backup-authorize" | "backup-register" | "backup-test";
  expires: number;
  accountId?: string;
  userId?: string;
  accountName?: string;
  payload?: string;
  marketTrade?: ExecutableMarketTrade;
  marketQuote?: ExecutableMarketQuote;
  quoteSession?: string;
  /** When the request for a stored market quote arrived at the wallet server. */
  quoteRequestedAt?: number;
  /** A stored market quote collected with the quick window; its input's full-window quote replaces it. */
  quoteQuick?: boolean;
  withdrawal?: WithdrawalReview;
  funding?: FundingReview;
}
export interface State {
  tokens?: Record<string, import("./token-registry").TokenRecord>;
  networks?: Record<string, import("./networks").Network>;
  accessRecords?: Record<string, import("./access").AccessRecord>;
  withdrawals?: Record<string, Withdrawal>;
  deposits?: Record<string, Deposit>;
  liveOrders?: Record<string, StoredOrder>;
  liveTrades?: Record<string, LiveTrade>;
  accounts: Record<string, Account>;
  sessions: Record<string, { accountId: string; expires: number; clientOrigin?: string; ceremony?: string; marketQuoteId?: string; confidential?: import("../../../../backend/id/src/near/services/confidential-sessions").ConfidentialSession }>;
  challenges: Record<string, Challenge>;
  requests: number[];
}
