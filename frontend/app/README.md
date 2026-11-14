# DYA Terminal

The trading terminal in the [DYA monorepo](../../README.md): a Vite React single-page app served by a Cloudflare Worker with static assets, at `http://localhost:3100` in development.

- `index.html`, `src/main.tsx`: page shell and providers.
- `components/`, `lib/`: UI and client logic.
- Account data refresh: the session and the orders and trades lists poll every 60 s and on tab focus, orders and trades every 5 s while one is still settling, balances every 2 minutes. This tab's own actions refresh what they change at once, and `components/query-provider.tsx` tells the browser's other Terminal tabs over a `BroadcastChannel`. A failed account request rechecks the session. Changes from another device or the ID site appear within 60 s.
- `lib/market-data/`: data API client, aligned page math, the shared WebSocket stream, the Vela chart's data provider and NEAR Intents overlay, and hooks. The browser talks to the data API directly (`VITE_DATA_API_ORIGIN`, default the local `http://127.0.0.1:8080`) for candles, tickers, Intents trades and the token picker's CoinGecko market data (`/v1/token-markets`); assets without a data-API market show "Chart unavailable".
- `worker/`: the Worker. It applies the internal access gate to every path, proxies `/api/wallet/*` and `/api/near/*` to DYA ID, and serves the Jev entry planner, which reads candles from the data API (`DATA_API_ORIGIN`). Everything else is a static asset; unknown paths fall back to `index.html`, unknown `/api/*` paths answer 404.

From the repository root, run `bun install --frozen-lockfile`, copy `frontend/app/.env.example` to `frontend/app/.env.local` (local Worker values that override `wrangler.jsonc` vars), and start with `bun run dev` on port 3100. Wallet features need DYA ID on port 3101 with the same `DYA_SERVICE_SECRET`. Public links in `@dya/config` (`DYA_APP_URL`, `DYA_ID_URL`, `DYA_DOCS_URL`) are inlined at build time and default to the local dev servers. Run `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build` at the root for validation.

`NEAR_AI_API_KEY` enables Jev Insights and chat on NEAR AI Cloud; without it Jev reports that it is not configured. Configured and signed orders and transfers are real actions.
