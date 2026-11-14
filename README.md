<p align="center">
  <img src="frontend/app/public/dya-logo.svg" alt="DYA" width="120" />
</p>

<h1 align="center">DYA Trade</h1>

<p align="center">A trading terminal powered by NEAR Intents.</p>

DYA Trade puts cross-chain trading in one professional terminal. Sign in with a passkey, deposit from the chain you already use, and trade with market and limit orders that settle through **NEAR Intents**, with balances kept confidential. A built-in AI assistant on **NEAR AI Cloud** trades alongside you: **Insights** marks suggested entry levels on the chart, and **chat**, running on a confidential TEE model, turns a plain-language request like "buy 0.1 NEAR at 3 USDC" into an order ready to review. With **Trading accounts on [OutLayer](https://outlayer.ai/)**, the assistant can place orders for you, inside limits you approve with your passkey.

## NEAR HACKATHON

DYA Trade is submitted to [NEAR HACKATHON](https://nearhackathon.com).

| | |
| --- | --- |
| Public repository | https://github.com/dya-labs/dya-trade-hackathon |
| Hosted app | https://app.dya.trade (NEAR mainnet) |

Cloudflare account and resource IDs are placeholders.

### The problem and the product

Trading a token that lives on another chain usually means a centralized exchange, or a separate wallet, bridge and DEX for each chain. AI-assisted trading is harder still: it tends to mean bots, scripts and API keys, built for developers and hard to trust with real money, and AI chat sends your balances and plans to a model provider in the clear.

DYA Trade brings both into one terminal. Sign in with a passkey (no seed phrase or browser extension), deposit from a supported chain, and place market and limit orders that settle through NEAR Intents. The AI sits right next to the chart: Insights suggests where to enter, chat turns plain words into an order, and Trading accounts let it place orders for you inside rules you approve. Chat runs inside NEAR AI Cloud's Trusted Execution Environments, so what you tell it and the wallet checks it runs stay private. No code, no API keys, no extra tools.

### How NEAR is used

- **NEAR Intents 1Click** quotes and executes market and limit orders, deposits, funding and withdrawals across chains (`backend/id`, `@defuse-protocol/one-click-sdk-typescript`).
- **Confidential NEAR Intents balances** hold what a user trades with. Every order is reviewed and approved with the user's passkey in DYA ID (`frontend/id`, `backend/id`).
- **NEAR Intents market data**: the data API indexes 1Click swaps settled on NEAR, from the NEAR Intents Explorer and FastNEAR, and serves them as NEAR Intents markets (`backend/data-api`). The chart's **Show Intents** overlay marks those swaps on the candles.
- **[OutLayer](https://outlayer.ai/)** powers Trading accounts: OutLayer wallets on NEAR, each owned by a passkey-controlled NEAR account. Each wallet's spending policy (which assets it trades and where its funds can go) is encrypted and registered with OutLayer's `outlayer.near` contract, and its limit orders, including those placed from chat, run through OutLayer (`backend/id/src/near/outlayer`).
- **[NEAR AI Cloud](https://near.ai/)** runs the assistant. Chat runs on `z-ai/glm-5.3-flash`, a confidential model inside NEAR AI's Trusted Execution Environments, so conversations, wallet checks and order drafts stay private. Insights asks TypeSafe's Jev decision model (`typesafe/jev-1.13`) through the NEAR AI Cloud gateway (`frontend/app/lib/analysis/near-ai.ts`).

### Features

- **One terminal, many chains.** Trade assets from many blockchains in one place, with live prices and charts. No bridges, no juggling wallets.
- **Sign in with a passkey.** No seed phrases and no browser extensions. Approve trades with your fingerprint or face.
- **Trading accounts, powered by OutLayer.** Separate accounts with spending rules you set, so the AI can trade for you without touching funds you haven't allowed.
- **Private by default.** Balances stay confidential, your trading history is encrypted, and chat runs on a confidential TEE model on NEAR AI Cloud.
- **Trade by chatting.** Describe the trade you want in everyday words and DYA drafts the order for you to check and confirm.
- **AI Insights.** Suggested entry levels drawn right on the chart. Buy across all of them with a single sentence.
- **Watch NEAR Intents in action.** One click shows real cross-chain swaps as markers on the chart.
- **Orders without the wait.** Prices are prepared in the background, so your order is ready the moment you hit Review.
- **Your whole portfolio at a glance.** Holdings, deposits, withdrawals and order activity in one view, on desktop and mobile.

### Hackathon timeline

Work on the market-data service (`backend/data-api`) started before the hackathon began on November 1. Everything else was built during the hackathon: the Terminal, DYA ID, trading through NEAR Intents, Trading accounts on OutLayer, and the AI features.

DYA Trade is a living product. We're still building it and adding new features.

### Try it

On https://app.dya.trade (mainnet, real funds; use small amounts):

1. Open the app - see the NEAR market: price header, chart, order ticket and Market trades.
2. Pick BTC in the asset selector, then click **Show Intents** in the chart's toolbar - NEAR Intents swaps of BTC appear as markers on the candles.
3. Click **Connect** and create an account with a passkey on DYA ID - see the wallet with its balances.
4. In the wallet, choose **Deposit**, then a token and network - see the deposit address and its expiry. Send a small amount; the balance updates once NEAR Intents credits it.
5. In the order ticket, choose **Market**, **Buy**, enter a size and click **Review** - see the 1Click quote with its fees. Approve with the passkey - the trade appears under Trade history once settled.
6. Click **Refresh levels** on the chart - Insights draws suggested entry levels on the candles.
7. Open **Chat** and describe a limit order in plain words, such as "buy 0.1 NEAR at 3 USDC for 24h" - see the order draft it prepares.

To run it locally, follow [Local setup](#local-setup). Without a 1Click JWT and provider settings on DYA ID, trading reports unavailable instead of failing silently. Without `NEAR_AI_API_KEY` on Terminal, Insights and chat report that they are not configured.

### Libraries and tools

Bun, React, Vite, Next.js (DYA ID), Cloudflare Workers and D1, TanStack Query and Table, Base UI and shadcn, Tailwind CSS, Zod, SimpleWebAuthn, jose, @noble and @scure, decimal.js, the NEAR Intents 1Click SDK, the OutLayer wallet API, the AI SDK with its OpenAI-compatible provider for NEAR AI Cloud, Vela, Vocs, and ClickHouse and Valkey for the data API. AI coding agents (Codex, Claude Code) were used throughout development.

DYA Trade is proprietary: all rights reserved, see [LICENSE](LICENSE).

## Repository structure

```text
frontend/
  app/              # Terminal: trading SPA and Cloudflare Worker
  id/               # DYA ID: wallet connection and approval screens
  docs/             # user documentation site (Vocs)
backend/
  data-api/         # Bun + ClickHouse market-data service (independent Bun install)
  id/               # wallet authority, passkeys, storage, and execution
packages/
  ui/               # shared components and theme
  wallet-contracts/ # private wallet protocol contracts
  wallet-sdk/       # private integration SDK
  wallet-react/     # private React dialog integration
  wallet-ui/        # shared deposit/withdrawal flows
  config/           # shared brand and public links
```

This is a Bun workspace monorepo. Terminal reads market data from `backend/data-api` and runs Jev Insights and chat on NEAR AI Cloud; wallet authority, including OutLayer Trading accounts, lives in `backend/id` and is exposed by `frontend/id`. The SDK packages remain private and unpublished.

Within `frontend/app`:

- `index.html`, `src/` — single-page app shell and providers.
- `components/` — UI components and client hooks.
- `lib/` — domain logic and provider integrations.
- `worker/` — Cloudflare Worker: access gate, DYA ID bridge, Jev Insights and chat (NEAR AI Cloud client in `lib/analysis/near-ai.ts`).
- `stories/` — Storybook states with mocked integrations.
- `tests/` — application and protocol tests.

## Local setup

Use Bun 1.4.4 from the repository root.

```sh
bun install --frozen-lockfile
cp -n frontend/app/.env.example frontend/app/.env.local
cp -n frontend/id/.dev.vars.example frontend/id/.dev.vars
```

Bun blocks the unused `unrs-resolver` postinstall; lint runs without trusting it. Browser/Worker TypeScript projects explicitly select their ambient types so tooling's `@types/bun` does not change browser `fetch` signatures. Node compatibility types remain required by DYA ID's Next code and `node:*` imports; no Node runtime fallback is used.

Set a stable environment-specific 32-byte hex `CONFIDENTIAL_SESSION_KEY` in DYA ID's environment. Put `ONE_CLICK_JWT` and wallet/provider configuration on DYA ID; `NEAR_AI_API_KEY` and the data API origins (`VITE_DATA_API_ORIGIN`, `DATA_API_ORIGIN`; default `http://127.0.0.1:8080`, a local `backend/data-api`) belong to Terminal. `DYA_APP_URL`, `DYA_ID_URL` and `DYA_DOCS_URL` set the public links (defaults: localhost 3100, 3101, 3105). Missing credentials report unavailable and fail closed.

Creating Trading accounts locally needs `OUTLAYER_ACTIVATION_PILOT=1` plus `OUTLAYER_RELAYER_ACCOUNT_ID` and `OUTLAYER_RELAYER_PRIVATE_KEY` (a mainnet account holding NEAR for gas) on DYA ID. Account setup spends real mainnet funds.

Start the two apps in separate terminals:

```sh
bun run db:migrate:id:d1:local
bun run db:init:id:d1:local
bun run dev:id
bun run dev
```

Open [Terminal](http://localhost:3100). Passkeys live on [DYA ID](http://localhost:3101); create a test wallet there. Wallet metadata and encrypted private sessions use local Worker D1 under `frontend/id/.wrangler/state`. Restart ID to verify persistence; `dev:id:d1` and workspace ID `dev` share the same database. Configured and signed orders/transfers are real actions.

See [DYA ID setup and boundary](backend/id/README.md) and [private SDK usage](packages/wallet-sdk/README.md).

## Workspaces and checks

- `frontend/app`: Terminal pages, trading UI, market data, and Jev Insights and chat on NEAR AI Cloud.
- `frontend/id`: hosted wallet connection and approval routes.
- `backend/id`: passkey verification, storage, confidential sessions, OutLayer Trading accounts, and execution workflows.
- `backend/data-api`: Bun market-data service (candles, tickers and a WebSocket stream from Binance, Bybit, OKX, KuCoin, Gate, MEXC and Kraken, plus NEAR indexers) with its own `bun.lock`.
- `packages/ui`: shared Terminal components, dark theme, and shadcn monorepo configuration.
- `packages/wallet-contracts`, `wallet-sdk`, `wallet-react`: private/unpublished shared contracts and internal SDK.
- `frontend/app/tests`: application, protocol, and wallet-bridge tests with mocked providers.

Run `bun run test`, `bun run typecheck`, `bun run typecheck:id`, `bun run lint`, `bun run lint:id`, `bun run build`, and `bun run build:id`. Both apps build for Cloudflare through Vite; `bun run start` serves Terminal's built Worker locally. Tests do not verify live provider credentials, real-device passkeys, liquidity, settlement, or funded execution.

Terminal and DYA ID show a shared recovery screen instead of a blank page when rendering fails.

## Storybook

```bash
bun run --filter app storybook
```

Open [localhost:6006](http://localhost:6006) to review deposit, withdrawal, funding, wallet, Trading account setup, order, transfer, trade-history, and trade-entry states. Stories render real components with mocked integration data and do not submit real transactions.

## Validation

```bash
bun run typecheck
bun run lint
bun run typecheck:id
bun run lint:id
bun run test
bun run --filter app build-storybook
(cd backend/data-api && bun run typecheck && bun test)
```

Automated tests do not establish live provider availability, liquidity, or successful funded settlement.
