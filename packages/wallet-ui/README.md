# Shared wallet flows

Private workspace used by DYA Terminal and DYA ID. Deposit and withdrawal components, token/network selectors, address and status displays, and the supporting query clients live here.

Render flows inside a React Query provider. Both apps use the same React Query version to share provider context. Requests use the hosting app's same-origin `/api/near` routes; server authorization, confidential access, and fixed refund enforcement remain authoritative.

`WithdrawalForm` accepts an `authenticate` function: Terminal’s adapter supplies the wallet SDK; standalone ID supplies native WebAuthn. `onClose` and `onDetails` belong to the hosting app. `onBusyChange` lets standalone navigation prevent leaving during preparation or submission. Wrap standalone flows with `StandaloneWalletContext.Provider` to render semantic page headings instead of dialog headings.

A lost submission response disables further submissions in that flow and directs the user to Activity. Inspect the outcome before attempting another withdrawal. Stories mock APIs and authentication and must never transfer real funds.

Dashboard and flows use one provider/cache. Reusable session, catalog, balance, deposit-status, transfer-history, and status-check hooks live under `src/hooks`. Reads refresh while visible, with focus refresh, rate-limit cooldowns, and error backoff. Transfer settlement invalidates balances. Confidential authorization failures hide cached balances; session changes and sign-out clear account-scoped data. Authentication mutations never retry automatically.
