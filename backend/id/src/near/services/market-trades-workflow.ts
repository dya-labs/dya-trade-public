import { BACKGROUND_MARKET_QUOTE_WAIT_MS, QUICK_MARKET_QUOTE_WAIT_MS } from "./one-click-market";
import { marketPreview } from "../../../../../packages/wallet-contracts/src/http/schemas/trading";
import { saveMarketQuote, takeMarketQuote, refreshMarketQuoteBalance, reuseMarketSigningPayload } from "./reusable-market-quote";
import { QuoteTimings } from "./quote-timings";
import { requireCurrentFeePlan, requireVerifiedTradingFees } from "./trading-fees";
import { discoverTokens, discoverTokensThen, requireTradingPair } from "./token-policy";
import { accountIdentity } from "../auth/intents";
import { StorageUnavailableError } from "../repositories/storage-error";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { DEFAULT_PAIR } from "../../../../../packages/wallet-contracts/src/domain/catalog";
import { readCatalog, resolvePair } from "../providers/catalog";
import { setCookie } from "./workflow-context";
import { canReconcile, nextRevision, mergeHashes, operationState } from "../../../../../packages/wallet-contracts/src/domain/reconciliation";

import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyAssertion } from "../auth/passkeys";

import { readDepositStatus } from "./one-click-deposit";

import { collectExecutableMarketQuote, prepareMarketSigningPayload, prepareExecutableMarketTrade, publishMarketIntent, validateExecutableMarketTrade } from "./market-execution";
import { encodeAssertion } from "../auth/intents";
import { randomUUID } from "node:crypto";

import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { accountFor, consumeChallenge, type Challenge } from "../repositories/store";

import { CEREMONY, admitAccount, cookieOptions, response, saveChallenge, type AccountWorkflowContext } from "./workflow-context";

export async function runMarketTrades(context: AccountWorkflowContext) {
  const { route, body, store, deployment, url, session, ceremony, balanceReader, account, held } = context;
    const quoting = route === "live/preview" && body.orderType === "market" && body.reusable === true;
    if (route === "live/market/prepare" || quoting) {
      const timings = new QuoteTimings(quoting ? "preview" : "prepare"), requestedAt = Date.now();
      let outcome: "success" | "error" = "error";
      try {
        if (account.kind !== "passkey" || !account.publicKey || !account.credentialId)
          throw new AppError(ErrorCode.ConnectAPasskeyToPrepareAMarketTrade);
        if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
        const credentialId = account.credentialId;
        const identity = accountIdentity(account);
        const catalog = await timings.measure("catalog", () => readCatalog());
        const pair = await resolvePair(body, async () => catalog);
        const balances = { accountId: identity.accountId, load: () => timings.measure("balances", () => balanceReader(identity.accountId, undefined, [pair.base, pair.quote])) };
        // Review's fresh balance read starts now, alongside the pair check and the cached-quote claim.
        // Keep its rejection handled until it is awaited; the miss path shares this one read.
        const freshBalance = quoting ? undefined : balances.load().then(value => ({ value }), error => ({ error }));
        // Discovery's read also checks the pair and loads the fee policy, on the service's snapshot
        // when there is one: the quote's save, the claim and the session check below decide again.
        const feePlan = await timings.measure("pair_access", () => discoverTokensThen(store, catalog, s => { requireTradingPair(s, pair); return requireVerifiedTradingFees(s, "market"); }, undefined, held));
        const jwt = process.env.ONE_CLICK_JWT ?? "";
        if (quoting) {
          // `fast`: the ticket's quick quote for a new input, requested together with the full-window one.
          const quick = body.fast === true;
          const quoteWaitingTimeMs = quick ? QUICK_MARKET_QUOTE_WAIT_MS : BACKGROUND_MARKET_QUOTE_WAIT_MS;
          const quote = await timings.measure("preview", () => collectExecutableMarketQuote(body, balances, jwt, undefined, undefined, undefined, pair, true, feePlan, timings, { allowShortfall: true, quoteWaitingTimeMs }));
          let warmed: Awaited<ReturnType<typeof prepareMarketSigningPayload>> | undefined;
          if (quote.shortfall === "0") {
            try { warmed = await prepareMarketSigningPayload(quote, identity.accountId, jwt, undefined, undefined, timings); }
            catch { console.warn("trading.quote.payload_warm_failed"); }
          }
          // Saving the quote rechecks the session, the pair and the fee plan in its own transaction;
          // only a quote that is not saved (unaffordable) needs the separate read. A quote overtaken
          // by a later request's, or a quick one by its input's full one, is checked but not stored,
          // and goes out without a reference.
          let quoteReference: string | undefined;
          if (quote.shortfall === "0") quoteReference = await timings.measure("cache", () => saveMarketQuote(store, session, account.id, quote, warmed, { reference: body.quoteReference, quick, requestedAt }));
          else await timings.measure("session", () => store.read(s => {
            if (admitAccount(accountFor(s, session)).id !== account.id) throw new AppError(ErrorCode.SessionChanged);
            requireTradingPair(s, pair); requireCurrentFeePlan(s, feePlan, "market");
          }));
          const result = response(marketPreview.parse({ ...quote, submissionEnabled: false, timeEstimateSeconds: null, quoteReference }));
          result.headers = { "Server-Timing": timings.header() };
          outcome = "success";
          return result;
        }
        const reviewBalances = { accountId: identity.accountId, load: async () => {
          const result = await freshBalance!;
          if ("error" in result) throw result.error;
          return result.value;
        } };
        const cached = await timings.measure("cache", () => takeMarketQuote(store, session, account.id, body.quoteReference, body, pair, feePlan, Date.now(), identity.accountId));
        const review = await timings.measure("prepare", async () => {
          if (!cached) return prepareExecutableMarketTrade(body, reviewBalances, jwt, undefined, undefined, undefined, pair, true, feePlan, timings);
          const refreshed = refreshMarketQuoteBalance(cached.quote, await reviewBalances.load(), identity.accountId);
          return reuseMarketSigningPayload(refreshed, cached.prepared, identity.accountId)
            ?? prepareMarketSigningPayload(refreshed, identity.accountId, jwt, undefined, undefined, timings);
        });
        await timings.measure("session", () => store.read(s => {
          if (admitAccount(accountFor(s, session)).id !== account.id) throw new AppError(ErrorCode.SessionChanged);
          requireTradingPair(s, pair); requireCurrentFeePlan(s, feePlan);
        }));
        const { options, challenge, raw } = await timings.measure("challenge", async () => {
          const options = await generateAuthenticationOptions({
            rpID: deployment.rpId, challenge: Buffer.from(review.challenge, "base64url"), userVerification: "required",
            allowCredentials: [{ id: credentialId, transports: account.transports }],
          });
          const challenge: Challenge = { value: options.challenge, purpose: "market-trade", payload: review.payload,
            marketTrade: review, accountId: account.id, expires: Date.parse(review.expiresAt) };
          return { options, challenge, raw: await saveChallenge(store, challenge, ceremony, context.bind) };
        });
        const res = response({ options, review: { ...review, payload: undefined, challenge: undefined } });
        setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: Math.max(1, Math.floor((Date.parse(review.expiresAt) - Date.now()) / 1000)) });
        res.challenge = challenge;
        res.headers = { "Server-Timing": timings.header() };
        outcome = "success";
        return res;
      } finally { timings.log(outcome); }
    }
    if (route === "live/market/submit") {
      if (account.kind !== "passkey" || !account.publicKey) throw new AppError(ErrorCode.ConnectAPasskeyToSubmitAMarketTrade);
      const c = await consumeChallenge(store, ceremony ?? "", "market-trade");
      if (c.accountId !== account.id || !c.payload || !c.marketTrade) throw new AppError(ErrorCode.MarketTradeChallengeMismatch);
      const identity = accountIdentity(account);
      if (c.marketTrade.confidentiality !== "advanced") throw new AppError(ErrorCode.PublicTradeSignaturesAreDisabled);
      if (c.marketTrade.pair?.quote.assetId !== DEFAULT_PAIR.quote.assetId) throw new AppError(ErrorCode.TradingNowUsesUSDCOnNEAR);
      validateExecutableMarketTrade(c.marketTrade, identity.accountId);
      await store.read(s => requireCurrentFeePlan(s, c.marketTrade!.feeReceipt?.plan, "market"));
      const catalog = await readCatalog();
      await discoverTokens(store, catalog);
      if (!catalog.some(a => a.assetId === c.marketTrade!.pair!.base.assetId) || !catalog.some(a => a.assetId === c.marketTrade!.pair!.quote.assetId)) throw new AppError(ErrorCode.TokenOperationUnavailable);
      await store.read(s => requireTradingPair(s, c.marketTrade!.pair!));
      const assertion = body as unknown as AuthenticationResponseJSON;
      const counter = await verifyAssertion(account, assertion, c.value);
      const signed = encodeAssertion(identity, c.payload, assertion);
      // The reviewed private payload is authorized locally by WebAuthn and
      // submitted only to 1Click. Never disclose it to the public verifier RPC.
      const tradeId = randomUUID();
      await store.transaction(s => {
        const current = accountFor(s, session);
        if (!current || current.id !== account.id || current.counter !== account.counter) throw new AppError(ErrorCode.ConcurrentSignatureTryAgain);
        requireTradingPair(s, c.marketTrade!.pair!);
        requireCurrentFeePlan(s, c.marketTrade!.feeReceipt?.plan, "market");
        current.counter = counter;
        s.liveTrades ??= {};
        s.liveTrades[tradeId] = { id: tradeId, ownerId: account.id, createdAt: Date.now(), updatedAt: Date.now(), state: "signing", review: c.marketTrade! };
      });
      try {
        const published = await publishMarketIntent(signed, process.env.ONE_CLICK_JWT ?? "");
        const trade = await store.transaction(s => {
          const current = s.liveTrades![tradeId]; current.state = "submitted"; current.intentHash = published.intentHash; current.updatedAt = nextRevision(current.updatedAt); return current;
        });
        return response({ trade: { ...trade, review: { ...trade.review, payload: undefined, challenge: undefined } } });
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw error;
        await store.transaction(s => { const current = s.liveTrades![tradeId]; current.state = "unknown"; current.updatedAt = Date.now(); });
        throw new AppError(ErrorCode.SubmissionOutcomeIsUnknownCheckOrdersBeforeRetrying);
      }
    }
    if (route === "live/trades/status") {
      const id = typeof body.id === "string" ? body.id : "";
      const trade = await store.read(s => s.liveTrades?.[id]);
      if (!trade || trade.ownerId !== account.id) throw new AppError(ErrorCode.TradeNotFound);
      const status = await readDepositStatus({ depositAddress: trade.review.depositAddress }, process.env.ONE_CLICK_JWT ?? "");
      const updated = await store.transaction(s => {
        const current = s.liveTrades![id];
        if (!canReconcile(current, trade)) return current;
        current.state = operationState(current.state, status.status) as typeof current.state;
        current.nearTxHashes = mergeHashes(current.nearTxHashes, status.nearTxHashes);
        const execution = status.execution;
        const pair = current.review.pair ?? DEFAULT_PAIR;
        const input = current.review.side === "buy" ? pair.quote : pair.base;
        const output = current.review.side === "buy" ? pair.base : pair.quote;
        // Actual amounts come exclusively from successful settlement, never from the reviewed quote.
        if (current.state === "settled" && execution &&
            new D(execution.inputAmount).mul(new D(10).pow(input.decimals)).eq(execution.inputRaw) &&
            new D(execution.outputAmount).mul(new D(10).pow(output.decimals)).eq(execution.outputRaw)) current.execution = execution;
        current.updatedAt = nextRevision(current.updatedAt); return current;
      });
      return response({ trade: { ...updated, review: { ...updated.review, payload: undefined, challenge: undefined } }, providerStatus: status.status });
    }
  return null;
}
