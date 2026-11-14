/** Compatibility evidence only; never authority to provision, spend, or open a session. */
export interface OutlayerOwnerCheck {
  phase: "verified";
  credentialId: string;
  publicKey: string;
  controllerId: string;
  codeHash: string;
  checkedAt: number;
}
/** Possession checked locally; authority is not installed until activation. */
export interface OutlayerRecoveryPasskey {
  phase: "prepared";
  id: string;
  publicKey: string;
  counter: number;
  transports?: import("@simplewebauthn/server").AuthenticatorTransport[];
  sourceCredentialId: string;
  sourcePublicKey: string;
  verifiedAt: number;
  authority: "full-owner";
}
export type OutlayerSetupView = {
  network: "mainnet";
  name: string;
  originalUnchanged: true;
  owner: "unchecked" | "verified";
  checkedAt?: number;
  controllerId: string;
  blockers: string[];
  canProvision: false;
  recovery?: { status: "needed" | "prepared" | "review-required"; verifiedAt?: number; authority: "full-owner"; installedOnChain: boolean };
};

/** An unfunded provider registration. Never an active Trading account. */
export type OutlayerSetupDraft = {
  id: string; controllerId: string; publicKey: string; credentialId: string; createdAt: number;
  sealedRegistrationReceipt?: string; registrationHttpStatus?: number; registrationFailure?: "transport" | "receipt-checkpoint" | "provider-rejected" | "response-validation" | "credential-checkpoint";
} & (
  | { phase: "registering" | "registration-unknown" }
  | { phase: "registered"; walletId: string; walletPublicKey: string; sealedApiKey: string }
  | { phase: "policy-ready"; walletId: string; walletPublicKey: string; sealedApiKey: string; encryptedPolicy: string; policyHash: string; policyKind?: "withdrawal-v1" | "transfer-v2" | "transfer-v3" }
);

export type OutlayerRecoveryCredential = { id: string; publicKey: string; counter: number; transports?: import("@simplewebauthn/server").AuthenticatorTransport[] };
export type OutlayerRecoveryEnrollment = {
  sourceCredentialId: string; sourcePublicKey: string; sessionHash: string;
} & (
  | { phase: "authorize" | "register" }
  | { phase: "test" | "prepared"; candidate: OutlayerRecoveryCredential }
);
