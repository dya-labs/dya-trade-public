import type { OutlayerRecoveryCredential, OutlayerRecoveryEnrollment } from "../../../../../packages/wallet-contracts/src/domain/outlayer-setup";

export function nextRecoveryEnrollment(state: OutlayerRecoveryEnrollment, event:
  | { type: "authorized" }
  | { type: "registered"; candidate: OutlayerRecoveryCredential }
  | { type: "tested"; counter: number }): OutlayerRecoveryEnrollment | undefined {
  if (state.phase === "authorize" && event.type === "authorized") return { ...state, phase: "register" };
  if (state.phase === "register" && event.type === "registered") {
    if (event.candidate.id === state.sourceCredentialId || event.candidate.publicKey === state.sourcePublicKey) return;
    return { ...state, phase: "test", candidate: event.candidate };
  }
  if (state.phase === "test" && event.type === "tested") return { ...state, phase: "prepared", candidate: { ...state.candidate, counter: event.counter } };
}
