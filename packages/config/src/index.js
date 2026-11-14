/** User-facing brand copy. Technical identities and trust settings remain independent. */
export const DYA_BRAND = Object.freeze({
  name: "Dya.trade",
  idName: "Dya ID",
  accountName: "Dya Account",
  tagline: "A private financial world, connected.",
  desc: "A private trading terminal for trading across networks from one account.",
});

/** Wallet display defaults only. Saved user names and wallet identities never
 * change when these labels change. Legacy Trading remains a separate fallback. */
export const DYA_WALLET_NAMES = Object.freeze({
  main: "Main",
  defaultTrading: "Trading",
  legacyTrading: "Main",
});

/** Static toast copy, including resolved brand text, for shared UI and copy validation. */
export const TOAST_MESSAGES = Object.freeze({
  confirmationCancelled: "Confirmation cancelled",
  confirmationExpired: "Confirmation expired",
  quoteExpired: "Quote expired",
  limitOrderSubmitted: "Limit order placed",
  orderConfirming: "Waiting for confirmation…",
  orderSubmitting: "Submitting order…",
  tradeProcessing: "Trade processing…",
  tradeCompleted: "Trade completed",
  tradeFailed: "Trade failed",
  tradeStatusUnavailable: "Trade status unavailable",
  orderStatusUnavailable: "Order status unavailable",
  orderSubmitted: "Order submitted",
  signInExpired: "Sign-in session expired",
  signOutFailed: "Sign-out failed",
  confirmationIncomplete: "Confirmation wasn’t completed",
  passkeyFailed: "Unable to confirm your passkey",
  accountReady: "Your account is ready",
  accountDraftResumed: "Continuing your existing account setup",
  changesSaved: "Changes saved",
  networkAvailable: "New network available",
  sessionEnding: "Session ending soon",
  connectionFailed: "Unable to connect",
  connecting: "Connecting…",
  changeUndone: "Change undone",
  keepChanges: "Keep these changes?",
  savingChanges: "Saving changes…",
  saveFailed: "Unable to save changes",
  requestFailed: "We couldn’t complete your request",
  walletConnectionIncomplete: "Wallet connection wasn’t completed",
  walletPopupBlocked: "Wallet popup blocked. Allow popups to continue.",
  walletRequestExpired: "Wallet request expired",
  idWindow: `Continue in the ${DYA_BRAND.idName} window`,
});
export const TOAST_ACTIONS = Object.freeze({
  retry: "Try again",
  undo: "Undo",
  keep: "Keep",
  cancel: "Cancel",
});

/** Public destinations. No secrets or authentication policy belong here.
 * App, ID and docs links come from DYA_APP_URL, DYA_ID_URL and DYA_DOCS_URL at build time
 * (Vite apps inline them through `define`); unset values fall back to the local dev servers.
 * Runtime origins and trust allowlists must still use their environment configuration.
 */
export const DYA_SOCIAL_HANDLES = Object.freeze({
  x: "dyatrade",
  telegram: "dyatrade",
});

/** Each reader references `process.env.NAME` literally so bundler `define` replacement applies. */
function publicUrl(read, fallback) {
  try { return read() || fallback; } catch { return fallback; }
}

export const DYA_URLS = Object.freeze({
  app: publicUrl(() => process.env.DYA_APP_URL, "http://localhost:3100"),
  id: publicUrl(() => process.env.DYA_ID_URL, "http://localhost:3101"),
  docs: publicUrl(() => process.env.DYA_DOCS_URL, "http://localhost:3105"),
  x: `https://x.com/${encodeURIComponent(DYA_SOCIAL_HANDLES.x)}`,
  xFollow: `https://twitter.com/intent/follow?screen_name=${encodeURIComponent(DYA_SOCIAL_HANDLES.x)}`,
  telegram: `https://t.me/${encodeURIComponent(DYA_SOCIAL_HANDLES.telegram)}`,
});
