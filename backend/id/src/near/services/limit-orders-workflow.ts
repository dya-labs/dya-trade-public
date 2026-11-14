import { QuoteTimings } from "./quote-timings";
import { pendingFeeDisclosure } from "../../../../../packages/wallet-contracts/src/domain/trading-fees";
import { requireCurrentFeePlan, requireVerifiedTradingFees, tradingFeeDisclosure } from "./trading-fees";
import { discoverTokens, discoverTokensThen, requireTradingPair } from "./token-policy";
import { accountIdentity } from "../auth/intents";
import { StorageUnavailableError } from "../repositories/storage-error";
import { withConfidentialSession } from "./confidential-sessions";
import { readCatalog, resolvePair } from "../providers/catalog";
import { setCookie } from "./workflow-context";
import { balanceFor } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";
import { verifyAssertion } from "../auth/passkeys";

import { OrderService } from "./orders";
import { OneClickOrders } from "../providers/one-click";
import { generateFunding, submitFunding, validateFunding } from "./funding";
import { previewLimit } from "../../../../../packages/wallet-contracts/src/domain/limit-preview";
import { previewMarket } from "./one-click-market";

import { encodeAssertion } from "../auth/intents";

import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { accountFor, consumeChallenge } from "../repositories/store";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";

import { CEREMONY, admitAccount, cookieOptions, response, saveChallenge, type AccountWorkflowContext } from "./workflow-context";

export async function runLimitOrders(context: AccountWorkflowContext) {
  const { route, body, store, deployment, url, session, ceremony, balanceReader, account } = context;
  const serviceCall = <T,>(operation: (service: OrderService) => Promise<T>) => withConfidentialSession(store, session, account.id,
    token => operation(new OrderService(store, new OneClickOrders(process.env.ONE_CLICK_JWT ?? "", fetch, true, token), true)));
    if (route === "live/orders/abandon") {
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      if (!requestId) throw new AppError(ErrorCode.MissingPreparationReference);
      const order = await store.transaction(s => {
        const current = Object.values(s.liveOrders ?? {}).find(o => o.ownerId === account.id && (o.requestId === requestId || o.preparationIds?.includes(requestId)));
        if (!current) return null;
        if (current.fundingState || (current.provider && (current.provider.depositedAmount !== "0" || current.provider.partialFills.length))) throw new AppError(ErrorCode.FundingMayHaveStarted);
        current.cancelPending = true;
        return current;
      });
      if (order && !(order.state === "failed" && !order.provider)) await serviceCall(service => service.sync(session, order.id, true));
      return response({ ok: true });
    }
    if (route === "live/orders/prepare") {
      const started = Date.now();
      if (account.kind !== "passkey" || !account.publicKey || !account.credentialId)
        throw new AppError(ErrorCode.ConnectAPasskeyToPrepareALimitOrder);
      if (url.hostname !== deployment.rpId) throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
      const catalog = await readCatalog();
      const pair = await resolvePair(body, async () => catalog);
      // Discovery's read also checks the pair and loads the fee policy.
      const feePlan = await discoverTokensThen(store, catalog, s => { requireTradingPair(s, pair); return requireVerifiedTradingFees(s, "limit"); });
      const identity = accountIdentity(account);
      const balances = await balanceReader(identity.accountId, undefined, [pair.base, pair.quote]);
      const preview = { ...previewLimit(body, balances, Date.now(), pair), feePlan };
      if (preview.shortfall !== "0") throw new AppError(ErrorCode.InsufficientIntentsBalanceForThisLimitOrder);
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      const apiKey = process.env.ONE_CLICK_JWT ?? "";
      const created = await serviceCall(service => service.create(session, requestId, preview));
      // Refresh authoritative status before inviting any signature on a reused order.
      const order = await serviceCall(service => service.sync(session, created.id));
      if (!order.provider) throw new AppError(ErrorCode.OneClickDidNotReturnAConfirmedOrder);
      const input = balanceFor(balances, order.preview.side === "buy" ? order.preview.request.data.attributes.quoteAsset : order.preview.request.data.attributes.baseAsset, order.preview.side === "buy" ? pair.quote : pair.base);
      if (new D(order.provider.fundingAmount).gt(input.raw))
        throw new AppError(ErrorCode.ProviderFeesMakeThisOrderExceedTheAvailableBalance);
      // Terminal's wallet bridge abandons a request after 25 s; answer before it with whatever
      // remains of a 20 s budget, so a slow provider yields this error, not a generic outage.
      const funding = await withConfidentialSession(store, session, account.id,
        token => generateFunding(order, apiKey, token, fetch, Math.max(1_000, started + 20_000 - Date.now())));
      await store.read(s => requireCurrentFeePlan(s, feePlan, "limit"));
      const options = await generateAuthenticationOptions({
        rpID: deployment.rpId, challenge: Buffer.from(funding.challenge, "base64url"), userVerification: "required",
        allowCredentials: [{ id: account.credentialId, transports: account.transports }],
      });
      const ceremonyExpires = Math.min(funding.expiresAt, Date.now() + 300000);
      const raw = await saveChallenge(store, { value: options.challenge, purpose: "order", payload: funding.payload,
        funding, accountId: account.id, expires: ceremonyExpires }, ceremony);
      const res = response({ options, review: { ...order.preview, submissionEnabled: true, orderId: order.id,
        fundingAmount: new D(order.provider.fundingAmount).div(new D(10).pow(input.decimals)).toFixed(),
        feeReceipt: order.provider.feeReceipt,
        fees: order.provider.feeReceipt ? `${order.provider.feeReceipt.totalBps} bps total listed trading fee; included in funding. Spread and price impact are separate.` : "Included in the provider funding amount" } });
      setCookie(res, CEREMONY, raw, { ...cookieOptions(), maxAge: Math.max(1, Math.floor((ceremonyExpires - Date.now()) / 1000)) });
      return res;
    }
    if (route === "live/orders/submit") {
      if (account.kind !== "passkey" || !account.publicKey) throw new AppError(ErrorCode.ConnectAPasskeyToFundALimitOrder);
      const c = await consumeChallenge(store, ceremony ?? "", "order");
      if (c.accountId !== account.id || !c.payload || !c.funding) throw new AppError(ErrorCode.LimitOrderChallengeMismatch);
      const order = await store.read(s => s.liveOrders?.[c.funding!.orderId]);
      if (!order || order.ownerId !== account.id) throw new AppError(ErrorCode.LimitOrderNotFound);
      const catalog = await readCatalog();
      await discoverTokens(store, catalog);
      const pair = await resolvePair({ baseAssetId: order.preview.request.data.attributes.baseAsset, quoteAssetId: order.preview.request.data.attributes.quoteAsset }, async () => catalog);
      await store.read(s => { requireTradingPair(s, pair); requireTradingPair(s, order.preview.pair); });
      if (order.preview.feePlan) await store.read(s => requireCurrentFeePlan(s, order.preview.feePlan!));
      const checked = validateFunding({ intent: { standard: "webauthn", payload: c.payload } }, order);
      if (checked.challenge !== c.funding.challenge || checked.providerId !== c.funding.providerId)
        throw new AppError(ErrorCode.LimitOrderFundingChangedBeforeSigning);
      const identity = accountIdentity(account);
      const assertion = body as unknown as AuthenticationResponseJSON;
      const counter = await verifyAssertion(account, assertion, c.value);
      const signed = encodeAssertion(identity, c.payload, assertion);
      // Obtain the user's 1Click session before recording a submission, so a missing session
      // asks the user to unlock instead of leaving this order's funding outcome unknown.
      const accessToken = await withConfidentialSession(store, session, account.id, async token => token);
      // Never send confidential payloads to the public verifier RPC.
      await store.transaction(s => {
        const current = accountFor(s, session);
        if (!current || current.id !== account.id || current.counter !== account.counter) throw new AppError(ErrorCode.ConcurrentSignatureTryAgain);
        const currentOrder = s.liveOrders?.[order.id];
        if (!currentOrder || currentOrder.ownerId !== account.id) throw new AppError(ErrorCode.OrderNotFoundWithPeriod);
        if (currentOrder.preview.feePlan) requireCurrentFeePlan(s, currentOrder.preview.feePlan);
        validateFunding({ intent: { standard: "webauthn", payload: c.payload } }, currentOrder);
        requireTradingPair(s, pair);
        requireTradingPair(s, currentOrder.preview.pair);
        current.counter = counter;
        currentOrder.fundingState = "submitting";
        currentOrder.updatedAt = Math.max(Date.now(), currentOrder.updatedAt + 1);
      });
      try {
        const submitted = await submitFunding(signed, process.env.ONE_CLICK_JWT ?? "", accessToken);
        await store.transaction(s => {
          s.liveOrders![order.id].fundingState = "submitted";
          s.liveOrders![order.id].fundingIntentHash = submitted.intentHash;
          s.liveOrders![order.id].updatedAt = Math.max(Date.now(), s.liveOrders![order.id].updatedAt + 1);
        });
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw error;
        await store.transaction(s => { s.liveOrders![order.id].fundingState = "unknown"; });
        throw new AppError(ErrorCode.FundingOutcomeIsUnknown);
      }
      let updated = order;
      try {
        updated = await serviceCall(service => service.sync(session, order.id));
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw error;
        updated = await store.read(s => s.liveOrders![order.id]);
      }
      return response({ order: updated });
    }
    if (route === "live/orders/status" || route === "live/orders/cancel") {
      const id = typeof body.id === "string" ? body.id : "";
      return response({ order: await serviceCall(service => service.sync(session, id, route.endsWith("/cancel"))) });
    }
    if (route === "live/preview") {
      const timings = new QuoteTimings();
      let outcome: 'success' | 'error' = 'error';
      try {
        if (account.kind !== "passkey" || !account.publicKey) throw new AppError(ErrorCode.ConnectAPasskeyToPreviewARealOrder);
        const catalog = await timings.measure('catalog', () => readCatalog());
        const pair = await resolvePair(body, async () => catalog);
        await timings.measure('pair_access', () => discoverTokensThen(store, catalog, s => requireTradingPair(s, pair)));
        const balances = await timings.measure('balances', () => balanceReader(accountIdentity(account).accountId, undefined, [pair.base, pair.quote]));
        const kind = body.orderType === "market" ? "market" : "limit";
        // The session check and fee terms share one snapshot.
        const { feePlan, tradingFee } = await timings.measure('session', () => store.read(s => {
          if (admitAccount(accountFor(s, session)).id !== account.id) throw new AppError(ErrorCode.SessionChanged);
          const feePlan = requireVerifiedTradingFees(s, kind);
          return { feePlan, tradingFee: feePlan ? (kind === "limit" ? pendingFeeDisclosure(feePlan) : undefined) : tradingFeeDisclosure(s, kind) };
        }));
        const preview = await timings.measure('preview', async () => kind === "market"
          ? previewMarket(body, balances, process.env.ONE_CLICK_JWT ?? "", undefined, undefined, pair, feePlan, undefined, timings)
          : { ...previewLimit(body, balances, Date.now(), pair), ...(feePlan ? { feePlan } : {}) });
        const result = response({ ...preview, tradingFee });
        result.headers = { 'Server-Timing': timings.header() };
        outcome = 'success';
        return result;
      } finally { timings.log(outcome); }
    }

  return null;
}
