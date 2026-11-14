import { DEFAULT_PAIR, quantityRaw } from "@/lib/near/domain/catalog";
import { createMarketEntryPlan } from "@/lib/analysis/market-entry-analysis";
import { catalogSchema } from "@/lib/near/domain/catalog";
import { balances } from "@dya/wallet-contracts/src/http/schemas/account";
import { D } from "@/lib/near/domain/decimal";
import { nearAiApiKey, nearAiChatModel } from "@/lib/analysis/near-ai";
import { APICallError, generateText, stepCountIs, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import { readRequestText } from "../../../packages/wallet-contracts/src/http/request-validation";
import { getDeploymentConfig } from "./config";
import { proxyWallet } from "./wallet-bridge";

const tradingSkill = `
DYA Terminal trading conventions:
- In Terminal trades, USDC means USDC on NEAR and NEAR means wNEAR on NEAR.
  Use lookupMarket for exact IDs. Never substitute USDC from another network.
- For Insights, use the current numbered prices from getInsights. An instruction
  to buy at all three NEAR Insights levels means three separate buy limit orders
  at the exact prices. An equal split uses one third of the total budget per order.
- A draft never places an order. If a fully specified placement request reaches
  this draft-only agent, explain how to submit it using the supported command.
  For three NEAR Insights buys with equal allocation and a 24h expiry, use:
  "Place limit buys across all 3 NEAR Insights levels with 0.36 USDC split equally for 24h."
  Replace 0.36 with the user's exact total budget. Never infer a budget or expiry.
- Ask only for genuinely missing terms or unresolved ambiguity. The standard
  NEAR and USDC mappings do not require clarification.
`;

function matchesTradingAsset(
  asset: z.infer<typeof catalogSchema>[number],
  ticker: string,
) {
  if (ticker === "NEAR" || ticker === "WNEAR") return asset.assetId === DEFAULT_PAIR.base.assetId;
  if (ticker === "USDC") return asset.assetId === DEFAULT_PAIR.quote.assetId;
  return asset.symbol.toUpperCase() === ticker;
}

const decimal = z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,24})?$/).refine(value => /[1-9]/.test(value));
const draftSchema = z.object({
  side: z.enum(["buy", "sell"]),
  base: z.string().regex(/^[A-Z0-9]{1,20}$/),
  quote: z.string().regex(/^[A-Z0-9]{1,20}$/),
  size: decimal,
  sizeUnit: z.enum(["base", "quote"]),
  limitPrice: decimal,
  expiry: z.enum(["1h", "24h", "7d"]),
});
const messagesSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
})).min(1).max(12);

export async function jevChat(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST" || request.headers.get("origin") !== getDeploymentConfig().origin ||
    !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Same-origin JSON request required." }, { status: 403, headers });
  }
  const apiKey = nearAiApiKey();
  if (!apiKey) return Response.json({ error: "Chat isn’t configured." }, { status: 503, headers });
  const raw = await readRequestText(request, 24_000);
  if (raw === null) return Response.json({ error: "Conversation is too long." }, { status: 413, headers });
  const payload = await new Response(raw).json().catch(() => null);
  const messages = messagesSchema.safeParse(payload?.messages);
  if (!messages.success || messages.data.at(-1)?.role !== "user") {
    return Response.json({ error: "Enter a message to continue." }, { status: 400, headers });
  }
  const session = await proxyWallet(new Request(new URL("/api/near/state", request.url), { headers: request.headers }), "state");
  const state = z.object({ account: z.object({ kind: z.literal("passkey"), tradingWallets: z.array(z.object({ id: z.string() })).optional() }) });
  const snapshot = state.safeParse(await session.json().catch(() => null));
  if (!session.ok || !snapshot.success) {
    return Response.json({ error: "Connect your wallet to use chat." }, { status: 401, headers });
  }
  const walletId = payload?.walletId;
  if (walletId != null && !snapshot.data.account.tradingWallets?.some(wallet => wallet.id === walletId)) {
    return Response.json({ error: "Selected wallet unavailable." }, { status: 403, headers });
  }

  async function read(path: string, query = "") {
    const url = new URL(`/api/near/${path}${query}`, request.url);
    const init = path === "outlayer/send-policy/trade-access"
      ? { method: "POST", headers: request.headers, body: "{}", signal: request.signal }
      : { headers: request.headers, signal: request.signal };
    const response = await proxyWallet(new Request(url, init), path);
    if (!response.ok) throw new Error("Check unavailable");
    return response.json();
  }
  const walletQuery = walletId ? `?account=${encodeURIComponent(walletId)}` : "";
  let catalog: Promise<z.infer<typeof catalogSchema>> | undefined;
  function assets() {
    return catalog ??= read("catalog").then(value => z.object({ assets: catalogSchema }).parse(value).assets);
  }
  const market = z.object({
    baseAssetId: z.string().min(1).max(256),
    quoteAssetId: z.string().min(1).max(256),
  }).safeParse(payload?.market);
  const selectedMarket = market.success ? market.data : undefined;
  const selectedNearMarket = selectedMarket?.baseAssetId === DEFAULT_PAIR.base.assetId &&
    selectedMarket.quoteAssetId === DEFAULT_PAIR.quote.assetId;

  const checks: { id: number; label: string; detail: string; failed: boolean }[] = [];
  async function check<T>(label: string, run: () => Promise<T>, summarize: (result: T) => string) {
    const entry = { id: checks.length, label, detail: "", failed: false };
    checks.push(entry);
    try {
      const result = await run();
      entry.detail = summarize(result);
      return result;
    } catch {
      entry.detail = "Couldn’t complete this check.";
      entry.failed = true;
      return { error: entry.detail };
    }
  }
  const model = nearAiChatModel(apiKey);
  const command = messages.data.at(-1)!.content;
  const batch = /^place limit buys across all 3 (NEAR )?Insights levels with ([0-9.]+) USDC(?: on NEAR)? split equally for 24h\.?$/i.exec(command);
  if (batch && (batch[1] || selectedNearMarket)) {
    const turn = z.uuid().safeParse(payload.turnId);
    const budget = decimal.safeParse(batch[2]);
    if (!walletId || !turn.success || !budget.success) {
      return Response.json({ error: "Select a Trading wallet and enter a valid USDC budget." }, { status: 400, headers });
    }
    try {
      const policy = z.object({ enabled: z.boolean(), allowedAssets: z.array(z.string()) }).parse(await read("outlayer/send-policy/trade-access", walletQuery));
      const catalog = await assets();
      const base = catalog.find(asset => asset.assetId === DEFAULT_PAIR.base.assetId);
      const quote = catalog.find(asset => asset.assetId === DEFAULT_PAIR.quote.assetId);
      if (!policy.enabled || !base || !quote ||
          !policy.allowedAssets.includes(base.assetId) || !policy.allowedAssets.includes(quote.assetId)) {
        return Response.json({ error: "Insights batches require Trading access and NEAR and USDC on NEAR in the selected wallet’s policy." }, { status: 409, headers });
      }
      const plan = await createMarketEntryPlan(base);
      if (plan.market?.quote !== "USDC" || plan.expiresAt <= Date.now() || plan.levels.length !== 3) {
        return Response.json({ error: "Three current NEAR/USDC Insights levels are required." }, { status: 409, headers });
      }
      const balance = z.object({ balances: z.array(z.object({ token: z.string(), balance: z.string().regex(/^\d+$/) })) }).parse(await read("outlayer/trading-balances", walletQuery));
      const scale = new D(10).pow(quote.decimals);
      const allocation = new D(budget.data).mul(scale).div(3).floor().div(scale);
      const available = new D(balance.balances.find(asset => asset.token === quote.assetId)?.balance ?? "0").div(scale);
      checks.push({ id: checks.length, label: "Wallet balance", detail: `${available.toFixed()} USDC available on NEAR`, failed: false });
      const belowMinimum = allocation.lt("0.10");
      if (belowMinimum || new D(budget.data).gt(available)) {
        const facts = {
          availableUsdcOnNear: available.toFixed(),
          requestedUsdc: budget.data,
          minimumBatchUsdc: "0.30",
          belowMinimum,
          insufficientBalance: new D(budget.data).gt(available),
          ordersSubmitted: 0,
        };
        const reason = belowMinimum ? "Three orders require at least 0.30 USDC total." : "The available balance is too low.";
        const fallback = `Your Trading wallet has ${facts.availableUsdcOnNear} USDC on NEAR and the batch needs ${facts.requestedUsdc} USDC. ${reason} No orders were submitted.`;
        const explanation = await generateText({
          model,
          system: "Explain in plain language why this limit order batch was blocked. State the exact available and requested amounts and that zero orders were submitted. Mention each blocker indicated by the supplied facts. Use only the supplied facts.",
          prompt: JSON.stringify(facts),
          abortSignal: request.signal,
        }).catch(() => undefined);
        return Response.json({ text: explanation?.text.trim() || fallback, checks }, { headers });
      }
      const orders = await Promise.all(plan.levels.map(async (level, index) => {
        const price = new D(level.price).toFixed();
        const size = allocation.div(price).toDecimalPlaces(base.decimals, D.ROUND_DOWN).toFixed();
        const rawAmount = quantityRaw(size, base.decimals);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${walletId}:${turn.data}:${index}`));
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        return { id, base: base.assetId, quote: quote.assetId, side: "buy", rawAmount, price, expiryHours: 24 };
      }));
      const outcomes: string[] = [];
      for (const [index, order] of orders.entries()) {
        const label = `Level ${index + 1} at ${order.price} USDC`;
        try {
          const path = "outlayer/send-policy/trade";
          const response = await proxyWallet(new Request(new URL(`/api/near/${path}${walletQuery}`, request.url), {
            method: "POST", headers: request.headers, body: JSON.stringify(order),
          }), path);
          const receipt = z.object({ status: z.string().optional(), order_id: z.string().optional(), request_id: z.string().optional() }).parse(await response.json());
          const reference = receipt.order_id ?? receipt.request_id;
          if (!response.ok || !reference) throw new Error("Unconfirmed");
          outcomes.push(`- ${label} — ${receipt.status ?? "accepted"} (${reference})`);
        } catch {
          outcomes.push(`- ${label} — placement unconfirmed. Check Open orders before retrying.`);
          break;
        }
      }
      if (outcomes.length < orders.length) outcomes.push(`- ${orders.length - outcomes.length} remaining level(s) were not submitted.`);
      return Response.json({ text: outcomes.join("\n"), checks }, { headers });
    } catch {
      return Response.json({ error: "Couldn’t prepare the Insights batch." }, { status: 502, headers });
    }
  }
  let marketInstructions = "";
  if (selectedMarket) {
    const catalog = await assets().catch(() => []);
    const base = catalog.find(asset => asset.assetId === selectedMarket.baseAssetId);
    const quote = catalog.find(asset => asset.assetId === selectedMarket.quoteAssetId);
    if (base && quote && base.assetId !== quote.assetId) {
      const baseTicker = base.assetId === DEFAULT_PAIR.base.assetId ? "NEAR" : base.symbol.toUpperCase();
      marketInstructions = `
Selected Terminal market: ${JSON.stringify({ baseTicker, quoteTicker: quote.symbol.toUpperCase(), ...selectedMarket })}.
Default to this pair for the latest request if the user has not specified another
market, including requests such as "buy at level 2" or "all 3 Insights levels".
Honor any market explicitly established for the request. For the selected pair,
use its exact asset IDs. Direct Insights batches currently support NEAR/USDC
only. Never suggest the NEAR batch command for a different market.
`;
    }
  }
  const agent = new ToolLoopAgent({
    model,
    reasoning: "low",
    stopWhen: stepCountIs(8),
    instructions: "You are the chat assistant in DYA Terminal. Help the user draft one limit order. Ask for missing or ambiguous side, pair, size and unit, limit price, or expiry. Preserve exact decimal strings and apply the user's latest corrections. Call draftLimitOrder once when all terms are clear, passing exact asset IDs from market lookup. A draft is for review only. Use lookupMarket, checkBalance, and checkPolicy before drafting when all terms are known. Resolve ambiguous assets with the user. Report failed checks or insufficient funds accurately. For Insights or Jev levels, call getInsights using the resolved base asset ID. Use the numbered level in returned order. If its reference quote differs from the order quote, ask the user to confirm using the same numerical price in the order quote unless explicitly instructed to do so. Never claim an order was placed." + tradingSkill + marketInstructions,
    tools: {
      lookupMarket: tool({
        description: "Look up catalog assets by their ticker. Confirm the exact asset IDs before checking wallet policy or balance.",
        inputSchema: draftSchema.pick({ base: true, quote: true }),
        execute: ({ base, quote }) => check("Market lookup", async () => {
          const catalog = await assets();
          const matches = (symbol: string) => catalog.filter(asset => matchesTradingAsset(asset, symbol))
            .slice(0, 15).map(({ assetId, symbol, blockchain }) => ({ assetId, symbol, blockchain }));
          return { base: matches(base), quote: matches(quote) };
        }, result => `${base}/${quote} · ${result.base.length} base and ${result.quote.length} quote matches`),
      }),
      checkBalance: tool({
        description: "Read available balance for one catalog asset on the selected wallet. For buys check the quote asset, for sells check the base asset.",
        inputSchema: z.object({ assetId: z.string().min(1).max(256) }),
        execute: ({ assetId }) => check("Wallet balance", async () => {
          const asset = (await assets()).find(item => item.assetId === assetId);
          if (!asset) throw new Error("Unknown asset");
          const amount = walletId
            ? new D(z.object({ balances: z.array(z.object({ token: z.string(), balance: z.string().regex(/^\d+$/) })) }).parse(await read("outlayer/trading-balances", walletQuery)).balances.find(item => item.token === assetId)?.balance ?? "0").div(new D(10).pow(asset.decimals)).toFixed()
            : balances.parse(await read("live/balances", "?all=true")).assets.find(item => item.assetId === assetId)?.amount ?? "0";
          return { amount, symbol: asset.symbol };
        }, result => `${result.amount} ${result.symbol} available`),
      }),
      checkPolicy: tool({
        description: "Check the selected wallet's Trading limit-order policy for the resolved pair.",
        inputSchema: z.object({ baseAssetId: z.string().min(1).max(256), quoteAssetId: z.string().min(1).max(256) }),
        execute: ({ baseAssetId, quoteAssetId }) => check("Wallet policy", async () => {
          if (!walletId) return { applies: false, enabled: null, pairAllowed: null };
          const policy = z.object({ enabled: z.boolean(), allowedAssets: z.array(z.string()) }).parse(await read("outlayer/send-policy/trade-access", walletQuery));
          return { applies: true, enabled: policy.enabled, pairAllowed: policy.allowedAssets.includes(baseAssetId) && policy.allowedAssets.includes(quoteAssetId) };
        }, result => !result.applies ? "Main wallet uses standard order review." : !result.enabled ? "Trading access is disabled." : result.pairAllowed ? "Both assets are allowed." : "This pair is outside the wallet’s allowed assets."),
      }),
      getInsights: tool({
        description: "Get the existing Insights entry levels in their displayed order for one resolved base asset.",
        inputSchema: z.object({ assetId: z.string().min(1).max(256) }),
        execute: ({ assetId }) => check("Insights", async () => {
          const asset = (await assets()).find(item => item.assetId === assetId);
          if (!asset) throw new Error("Insights unavailable");
          const plan = await createMarketEntryPlan(asset);
          const quote = plan.market?.quote ?? "USDC";
          return {
            market: plan.symbol,
            quote,
            asOf: new Date(plan.asOf).toISOString(),
            levels: plan.levels.map((level, index) => ({ number: index + 1, price: new D(level.price).toFixed() })),
          };
        }, result => `${result.market} · ${result.levels.map(level => `Level ${level.number}: ${level.price} ${result.quote}`).join(" · ")} · ${result.asOf}`),
      }),
      draftLimitOrder: tool({
        description: "Prepare one unsubmitted limit-order draft using the user's explicit terms.",
        inputSchema: draftSchema.extend({ baseAssetId: z.string(), quoteAssetId: z.string() }),
        execute: async draft => {
          const catalog = await assets();
          const base = catalog.find(asset => asset.assetId === draft.baseAssetId);
          const quote = catalog.find(asset => asset.assetId === draft.quoteAssetId);
          if (!base || !quote || base.assetId === quote.assetId ||
              !matchesTradingAsset(base, draft.base) || !matchesTradingAsset(quote, draft.quote)) return null;
          return { ...draft, walletId };
        },
      }),
    },
  });
  try {
    const result = await agent.generate({ messages: messages.data, abortSignal: request.signal });
    const output = result.steps.flatMap(step => step.toolResults)
      .find(item => item.toolName === "draftLimitOrder")?.output;
    const parsed = draftSchema.extend({ baseAssetId: z.string(), quoteAssetId: z.string() }).safeParse(output);
    const draft = parsed.success ? { ...parsed.data, walletId } : undefined;
    if (/^place a limit order\b/i.test(command)) {
      // Direct execution requires terms that can be independently checked against the user message.
      const terms = /^place a limit order(?: to)? (buy|sell) ([\d.]+) ([a-z0-9]+) at ([\d.]+) ([a-z0-9]+) for (1h|24h|7d)\.?$/i.exec(command);
      if (!walletId || !terms || !draft || !z.uuid().safeParse(payload.turnId).success ||
          draft.sizeUnit !== "base" || draft.side !== terms[1].toLowerCase() || draft.size !== terms[2] ||
          draft.base !== terms[3].toUpperCase() || draft.limitPrice !== terms[4] ||
          draft.quote !== terms[5].toUpperCase() || draft.expiry !== terms[6].toLowerCase()) {
        return Response.json({ text: "To place directly, select a Trading wallet and use: Place a limit order to buy 0.1 NEAR at 3 USDC for 24h.", draft, checks }, { headers });
      }
      const catalog = await assets();
      const base = catalog.find(asset => asset.assetId === draft.baseAssetId)!;
      const quote = catalog.find(asset => asset.assetId === draft.quoteAssetId)!;
      const policy = z.object({ enabled: z.boolean(), allowedAssets: z.array(z.string()) }).parse(await read("outlayer/send-policy/trade-access", walletQuery));
      const allowed = (symbol: string) => catalog.filter(asset => policy.allowedAssets.includes(asset.assetId) &&
        matchesTradingAsset(asset, symbol));
      if (!policy.enabled || allowed(draft.base).length !== 1 || allowed(draft.quote).length !== 1 ||
          allowed(draft.base)[0]?.assetId !== base.assetId || allowed(draft.quote)[0]?.assetId !== quote.assetId) {
        return Response.json({ text: "The Trading policy does not resolve this pair uniquely.", draft, checks }, { headers });
      }
      const rawAmount = quantityRaw(draft.size, base.decimals);
      const balances = z.object({ balances: z.array(z.object({ token: z.string(), balance: z.string().regex(/^\d+$/) })) }).parse(await read("outlayer/trading-balances", walletQuery));
      const spend = draft.side === "buy" ? quote : base;
      const required = draft.side === "buy" ? new D(draft.size).mul(draft.limitPrice).mul(new D(10).pow(quote.decimals)) : new D(rawAmount);
      if (required.gt(balances.balances.find(asset => asset.token === spend.assetId)?.balance ?? "0")) {
        return Response.json({ text: "Insufficient Trading balance for this order.", draft, checks }, { headers });
      }
      const path = "outlayer/send-policy/trade";
      const url = new URL(`/api/near/${path}${walletQuery}`, request.url);
      const response = await proxyWallet(new Request(url, { method: "POST", headers: request.headers, body: JSON.stringify({
        id: payload.turnId, base: base.assetId, quote: quote.assetId, side: draft.side, rawAmount, price: draft.limitPrice,
        expiryHours: { "1h": 1, "24h": 24, "7d": 168 }[draft.expiry],
      }) }), path);
      const receipt = z.object({ status: z.string().optional(), order_id: z.string().optional(), request_id: z.string().optional() }).safeParse(await response.json().catch(() => null));
      const text = response.ok && receipt.success && (receipt.data.order_id || receipt.data.request_id)
        ? `OutLayer status: ${receipt.data.status ?? "accepted"}. Reference: ${receipt.data.order_id ?? receipt.data.request_id}.`
        : "OutLayer did not confirm placement. Check Open orders before sending a new instruction.";
      return Response.json({ text, checks }, { headers });
    }
    return Response.json({ text: result.text || (draft ? "Here’s your limit-order draft." : "Could you clarify the order you want to draft?"), draft, checks }, { headers });
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const status = APICallError.isInstance(error) ? error.statusCode : undefined;
    console.warn("chat.generation.failed", { name, status });
    const message = status === 401 || status === 403
      ? "Chat couldn’t authenticate with NEAR AI Cloud."
      : status === 404 ? "The chat model is unavailable."
      : "Chat couldn’t respond. Try again.";
    return Response.json({ error: message }, { status: 502, headers });
  }
}
