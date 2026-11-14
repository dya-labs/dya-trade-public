export class WalletRequestError extends Error {}
// The ID server's answer when a DYA ID session is still signed in.
export async function getRegistrationOptions() { throw new WalletRequestError("Sign out before creating a new passkey account"); }
export async function getLoginOptions() { throw new DOMException("Cancelled", "NotAllowedError"); }
export async function registerPasskey() { throw new Error("Storybook does not register passkeys."); }
export async function loginPasskey() { throw new Error("Storybook does not sign in."); }
export async function finishConnection() { throw new Error("Storybook does not connect wallets."); }
export async function finishApproval() { return { status: 200 }; }
