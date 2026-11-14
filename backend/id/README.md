# DYA ID service

Private server workspace served through `frontend/id`'s Next.js routes. It owns passkey verification, wallet records, confidential provider sessions, deposits, withdrawals, funding, and signed trading execution. DYA Terminal owns market UI, market data, and Jev analysis. Terminal wallet requests use the service bridge.

## Local development

Use Bun 1.4.4 and run `bun install --frozen-lockfile` at the repository root. Copy `frontend/id/.dev.vars.example` to the ignored `.dev.vars`, replace the encryption placeholder with a stable development-only 32-byte hex key, and share the local bridge secret with Terminal's server configuration. Provider credentials belong on ID; missing credentials fail closed. NEAR AI Cloud credentials belong on Terminal, not ID.

```sh
bun run db:migrate:id:d1:local
bun run db:init:id:d1:local
bun run dev:id
# Same database and command: bun run dev:id:d1 or bun run --filter id dev
```

Network and token approvals, DYA trading fees and deposit refund addresses are reviewed records in D1; trading, deposit and withdrawal paths read them from there. Catalog discovery adds unknown networks and tokens as pending with every capability off.

Start Terminal separately on 3100. ID uses the Worker runtime and real local D1 on `http://localhost:3101` (RP `localhost`). Create a local test wallet, restart ID, and verify its session/account persists. Registration alone submits no blockchain transaction. Default commands never migrate/initialize implicitly.

Vite and Wrangler share absolute `frontend/id/.wrangler/state`; their resource directory is `v3`. The initializer's getPlatformProxy needs that versioned directory explicitly. Tests use a separate temporary root via DYA_ID_D1_LOCAL_STATE, never developer state. `wrangler.jsonc` and `wrangler.local.jsonc` bind local D1 only, with remote bindings disabled. Origins (`APP_ORIGIN`, `DYA_TERMINAL_ORIGIN`, `PASSKEY_RP_ID`, `DATA_API_ORIGIN`) come from those vars or `.dev.vars`; the passkey RP ID and recovery-wallet signing domain derive from `APP_ORIGIN`.

Run `bun run test:id:d1`, `bun run typecheck:id:d1`, `bun run typecheck:id`, `bun run lint:id`, `bun run test`, and `bun run build:id:d1:local`. For the real Worker migration/register/restart/alias test run `DYA_ID_RUN_LOCAL_WORKER=1 bun run test:id:d1 tests/d1-local-worker.test.ts`. This uses a synthetic authenticator with real passkey verification and no live provider actions.

D1 schema 2 uses eight-statement full snapshots even for scoped reads. Guarded changed-record batches validate record reads, absent records, scan epochs, rate history and metadata lifecycle versions, with three total attempts, no replay after ambiguous transport outcomes, readiness/origin/schema fencing, and request-wide statement budgets. Free reserves 40 units, Paid 800; reads reserve three units/statement for automatic read retries. The full-snapshot workload requires Workers Paid. A held refresh lease returns 503/Retry-After 1 immediately. Availability/conflict/budget/busy responses are sanitized and no-store.

## Connection and approval boundary

ID enforces a per-response nonce for scripts, same-origin browser connections, no nested frames or plugins, and a fixed image-host allowlist. Only `/flow/` pages allow the configured Terminal and ID itself as frame ancestors; other pages and authentication failures deny framing. Incoming nonce/policy headers are overwritten. Inline styles remain allowed for React and shared dialog positioning, but inline scripts require the generated nonce. Development alone permits eval and HMR WebSockets. Keep opener communication intact: adding a blanket cross-origin opener policy would break the popup flow.

The fixed dark theme is rendered in HTML without a theme initialization script. Responses include no-store, no-referrer, nosniff, restricted browser permissions, and HSTS on HTTPS. Domain and replay tests are in `frontend/app/tests/id-security-headers.test.ts`, `wallet-service-bridge.test.ts`, `wallet-bff.test.ts`, and `near-api.test.ts`.

Terminal uses a server-side service credential and HttpOnly app-grant cookie. Connection codes are single use and bound to a browser verifier. A separate DYA ID host session owns login; provider credentials move into the approved grant and are encrypted with that grant's binding. Disconnect revokes the app grant.

Every signature is generated in wallet-origin content and verified against the stored operation/account/challenge. Terminal receives an opaque approval receipt and retrieves the recorded result for the matching grant and route; it cannot relay arbitrary assertions through the service API. Reviews use server-stored terms. Messages require the exact wallet origin, iframe or popup source, and flow ID. Only the configured Terminal may frame wallet flows. No public confidential-transfer fallback is introduced.

An unsupported/unready iframe falls back to the same hosted flow in a separate desktop popup or mobile tab, following Porto. Terminal stays open and its pending request resumes from an origin/source/flow-validated message; connection codes are exchanged before the popup closes. Closing a popup cancels the pending request; blocked popups expose a user-gesture retry. Manually opened hosted flows without an opener retain callback-and-return recovery (which resets unsaved UI state). Unknown submission outcomes remain recorded and must be checked, never automatically resubmitted.

External-wallet recovery has separate local-simulator and real-provider paths. The simulator can be exercised end to end on fresh local recovery test accounts; simulator accounts keep live operations disabled permanently. Backup passkey recovery is not enabled.

## Errors and logs

API errors return `{ error, code?, requestId }`. `error` is shown to users only for reviewed `AppError` codes in `packages/wallet-contracts/src/domain/errors.ts` (codes in `INTERNAL_ERRORS` excluded); anything else answers `Something went wrong. Reference: <requestId>`. `requestId` is the request's Cloudflare Ray ID (random locally). Each failure is logged once as a structured `request.error` event (request ID, operation with IDs masked, status, code, error name, message, and the stack for unexpected errors).

Invocation logs are disabled because request URLs carry bearer flow IDs and one-time codes; never log URLs, bodies or headers. A Terminal bridge failure logs `wallet.bridge.response` with both its own `requestId` and the ID Worker's `idRequestId`.
