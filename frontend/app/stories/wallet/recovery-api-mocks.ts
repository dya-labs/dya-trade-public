const proof = { message: "localhost:3101\n\nLocal recovery test proof.\nThis wallet will have FULL CONTROL of my DYA wallet, including moving all funds.\nPasskey: synthetic replacement\nNonce: synthetic single-use nonce", expiresAt: 4102444800000 };
export async function connectRecoveryWallet() { return { address: "0x1111111111111111111111111111111111111111", chainId: 1, sign: async () => "synthetic-story-signature" }; }
export const recoveryClient = {
  authorize: async () => ({ challenge: "synthetic-passkey-challenge" }),
  approve: async () => proof,
  enroll: async () => ({ ok: true, status: "local_test", recoveryId: "synthetic-recovery-id" }),
  register: async () => ({ challenge: "synthetic-registration-challenge" }),
  replacement: async () => proof,
  recover: async () => ({ ok: true, status: "local_test" }),
};
let providerPhase = 'recover_register';
export function setProviderRecoveryPhase(phase: string) { providerPhase = phase; }
const providerResult = () => ({ phase: providerPhase, ...(providerPhase === "recover_discover" ? { message: "localhost wants you to sign with your Ethereum account:\nFind my DYA accounts linked to this recovery wallet.\nThis proof only discovers accounts. It does not authorize key changes or transfers.", expiresAt: 4102444800000 } : providerPhase === "recover_select" ? { accounts: [{ id: "one", label: "DYA account one" }, { id: "two", label: "DYA account two" }] } : providerPhase.endsWith('_pending') ? { pending: true } : providerPhase === 'complete' ? { recoveryId: 'synthetic-recovery-id' } : ['recover_register', 'recover_test', 'recover_finish', 'enroll_key'].includes(providerPhase) ? { options: { challenge: 'synthetic-passkey-challenge', rp: { name: 'DYA ID', id: 'localhost' }, user: { id: 'c3ludGhldGlj', name: 'test', displayName: 'test' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] }, expiresAt: 4102444800000 } : { message: JSON.stringify({ signer_id: "synthetic original wallet", intents: providerPhase === "enroll_auth" ? [] : [{ intent: providerPhase === "recover_remove" ? "remove_public_key" : "add_public_key", public_key: providerPhase === "recover_remove" ? "synthetic previous key" : "synthetic replacement" }] }), expiresAt: 4102444800000 }) });
export const providerRecoveryClient = {
  discover: async () => providerResult(),
  select: async () => { providerPhase = "recover_register"; return providerResult(); },
  enroll: async () => { providerPhase = 'enroll_ownership'; return providerResult(); },
  recover: async () => providerResult(),
  advance: async (phase: string) => { providerPhase = ({ recover_discover: 'recover_select', enroll_ownership: 'enroll_key', enroll_key: 'enroll_pending', enroll_auth: 'complete', recover_register: 'recover_add', recover_add: 'recover_add_pending', recover_test: 'recover_remove', recover_remove: 'recover_remove_pending', recover_finish: 'complete' } as Record<string,string>)[phase] ?? phase; return providerResult(); },
  status: async () => { providerPhase = ({ enroll_pending: 'enroll_auth', recover_add_pending: 'recover_test', recover_remove_pending: 'recover_finish' } as Record<string,string>)[providerPhase] ?? providerPhase; return providerResult(); },
};
