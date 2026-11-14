import { feeReceiptSummary } from "../../../../packages/wallet-contracts/src/domain/trading-fees";
import { errorResponse, relayWalletResponse } from "../near/http/storage-response";
import { AppError, ErrorCode } from "../../../../packages/wallet-contracts/src/domain/errors";
import { createStorageRequestContext, StatementBudget, type StorageRequestContext } from "../near/repositories/request-budget";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bridgeConfig, checkServiceSecret } from "./config";
import { handleNear } from "../near/http/api";
import { getStore, hash, accountFor, scopedStore, heldSnapshot, type StateStore } from "../near/repositories/store";
import { transferConfidentialSession } from "../near/services/confidential-sessions";
import { D } from "../../../../packages/wallet-contracts/src/domain/decimal";
import { DEFAULT_PAIR } from "../../../../packages/wallet-contracts/src/domain/catalog";
import { SESSION, CEREMONY, token, SESSION_AGE, preparedChallenges, sessionSnapshot, type CeremonyBinder, type ServiceAdmission } from "../near/services/workflow-context";
import type { HostedFlow, Challenge } from "../../../../packages/wallet-contracts/src/domain/state";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const flowInput = z.object({ action: z.enum(["connect", "approval"]), verifierHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/), kind: z.enum(["login", "register"]).optional(), challenge: z.string().max(2048).optional() });
const submitRoutes: Partial<Record<Challenge["purpose"], string>> = {
  "confidential-auth": "confidential/unlock", "market-trade": "live/market/submit", order: "live/orders/submit",
  withdraw: "transfers/submit", "funding-conversion": "funding/submit", intents: "intents/verify",
  "backup-authorize": "backup/authorize/verify", "backup-register": "backup/register/verify", "backup-test": "backup/test/verify",
};
const secretKey = () => createHash("sha256").update(bridgeConfig().secret).digest();
function seal(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
function open(value: string) {
  const bytes = Buffer.from(value, "base64url"), decipher = createDecipheriv("aes-256-gcm", secretKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
}
export async function walletRequest(path: string, body: unknown, session?: string, ceremony?: string, store?: StateStore, storageContext: StorageRequestContext = createStorageRequestContext(), admitted?: ServiceAdmission) {
  const { wallet } = bridgeConfig();
  const headers = new Headers({ host: new URL(wallet.origin).host, origin: wallet.origin });
  if (wallet.password) headers.set("authorization", `Basic ${Buffer.from(`tester:${wallet.password}`).toString("base64")}`);
  const cookies = [session && `${SESSION}=${session}`, ceremony && `${CEREMONY}=${ceremony}`].filter(Boolean);
  headers.set("cookie", cookies.join("; "));
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleNear(new NextRequest(`${wallet.origin}/api/near/${path}`, { method: body === undefined ? "GET" : "POST", headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), path.split("?")[0].split("/"), store, undefined, undefined, undefined, storageContext, admitted);
}
/**
 * Numeric `Server-Timing` stages of one service request, closed by this request's D1 batches
 * (count, wall time, rows, SQL time, D1 location) and the total. Terminal forwards them for
 * quotes and Reviews only. `startedAt` is the request's wall-clock start.
 */
function serviceTimings(storageContext: StorageRequestContext) {
  const started = performance.now(), startedAt = Date.now(), stages: string[] = [];
  const ms = (value: number) => Math.round(value * 10) / 10;
  return {
    startedAt,
    async measure<T>(stage: string, run: () => Promise<T> | T): Promise<T> {
      const stageStarted = performance.now();
      try { return await run(); }
      finally { stages.push(`id_${stage};dur=${ms(performance.now() - stageStarted)}`); }
    },
    header(handler: string | null) {
      const d1 = storageContext instanceof StatementBudget ? [`id_d1;dur=${ms(storageContext.batchMs)};desc="${storageContext.batches} batches, ${storageContext.rowsRead} rows read, ${ms(storageContext.sqlDurationMs)} ms sql${storageContext.servedBy ? `, ${storageContext.servedBy}` : ""}"`] : [];
      return [handler, ...stages, ...d1, `id_total;dur=${ms(performance.now() - started)}`].filter(Boolean).join(", ");
    },
  };
}
type State = Parameters<Parameters<StateStore["read"]>[0]>[0];
/** A hosted approval flow for the session's prepared ceremony `c`, bound to its challenge and submit route. */
function approvalFlow(s: Pick<State, "accounts" | "liveOrders">, grant: State["sessions"][string], c: Challenge | undefined, verifierHash: string, session: string, ceremony: string) {
  const config = bridgeConfig();
  const binding = c?.purpose === "outlayer-withdrawal" ? c.outlayerSendPolicy : undefined;
  const submitRoute = binding?.withdrawalId
    ? `outlayer/send-policy/withdrawal-approve?${new URLSearchParams({ account: binding.walletId, withdrawal: binding.withdrawalId })}`
    : c && submitRoutes[c.purpose];
  if (!c || c.expires <= Date.now() || c.accountId !== grant.accountId || !submitRoute) throw new AppError(ErrorCode.ApprovalDoesNotMatchThePreparedOperation);
  const account = s.accounts[grant.accountId];
  const flow: HostedFlow = {
    kind: "approval", clientOrigin: config.clientOrigin, callback: config.callback, verifierHash, status: "pending",
    session: seal(session), ceremony: seal(ceremony), submitRoute,
    options: c.hostedOptions ?? { challenge: c.value, rpId: config.wallet.rpId, userVerification: "required", allowCredentials: [{ type: "public-key", id: c.purpose === "backup-test" ? account.backup?.id : account.credentialId, transports: c.purpose === "backup-test" ? account.backup?.transports : account.transports }] },
    review: { ...reviewFor(c, s), account: grant.accountId },
  };
  return { flow, expires: Math.min(Date.now() + 300000, c.expires) };
}
function reviewFor(c: Challenge, state: Pick<State, "accounts" | "liveOrders">) {
  if (c.purpose === "outlayer-withdrawal" && c.outlayerWithdrawalReview) return { title: "Review withdrawal", details: c.outlayerWithdrawalReview };
  if (c.withdrawal) return { title: "Review withdrawal", details: { asset: c.withdrawal.asset, amount: c.withdrawal.amount, estimatedReceive: c.withdrawal.expectedReceive, recipient: c.withdrawal.destinationWallet, network: c.withdrawal.destinationChain, minimumReceived: c.withdrawal.minimumReceive, expires: c.withdrawal.deadline } };
  if (c.marketTrade) { const pair = c.marketTrade.pair ?? DEFAULT_PAIR; return { title: "Review market trade", details: { sourceAsset: c.marketTrade.side === "buy" ? pair.quote : pair.base, destinationAsset: c.marketTrade.side === "buy" ? pair.base : pair.quote, slippageBps: c.marketTrade.slippageBps, slippagePolicy: c.marketTrade.slippagePolicy, side: c.marketTrade.side, inputAsset: c.marketTrade.inputSymbol, inputAmount: c.marketTrade.principal, outputAsset: c.marketTrade.outputSymbol, quantity: c.marketTrade.quantity, estimatedOutput: c.marketTrade.estimatedOutput, minimumOutput: c.marketTrade.minimumOutput, dyaFeeBps: c.marketTrade.feeReceipt?.plan.requestedDyaBps ?? 0, fees: c.marketTrade.feeReceipt ? feeReceiptSummary(c.marketTrade.feeReceipt) : undefined, expires: c.marketTrade.expiresAt } }; }
  if (c.funding) { const order = state.liveOrders?.[c.funding.orderId]; const pair = order?.preview.pair ?? DEFAULT_PAIR; const asset = order?.preview.side === "buy" ? pair.quote : pair.base; return { title: "Fund limit order", details: order ? { side: order.preview.side, quantity: order.preview.quantity, price: order.preview.price, quoteAsset: pair.quote.symbol, baseAsset: pair.base, quoteToken: pair.quote, sourceAsset: asset, orderExpires: order.preview.request.data.attributes.deadline, fundingAsset: asset.symbol, fundingAmount: order.provider ? new D(order.provider.fundingAmount).div(new D(10).pow(asset.decimals)).toFixed() : undefined, dyaFeeBps: order.provider?.feeReceipt?.plan.requestedDyaBps ?? order.preview.feePlan?.requestedDyaBps ?? 0, fees: order.provider?.feeReceipt ? feeReceiptSummary(order.provider.feeReceipt) : "Included in funding", expires: c.expires } : {} }; }
  if (c.fundingBatchId) { const leg = state.accounts[c.accountId!]?.fundingBatches?.[c.fundingBatchId]?.legs.find(l => l.id === c.fundingLegId); return { title: "Review funding conversion", details: leg ? { asset: leg.asset.symbol, estimatedCost: leg.asset.price === undefined ? null : new D(leg.amount).mul(leg.asset.price).minus(leg.review.estimatedOutput).toFixed(), sourceAsset: leg.asset, destinationAsset: leg.review.pair?.quote, amount: leg.amount, outputAsset: leg.review.outputSymbol, estimatedOutput: leg.review.estimatedOutput, minimumOutput: leg.review.minimumOutput, expires: leg.review.expiresAt } : {} }; }
  return { title: c.purpose === "confidential-auth" ? "Unlock confidential balances" : c.purpose.startsWith("backup") ? "Confirm backup passkey setup" : "Check passkey signing", details: {} };
}
export async function readFlow(id: string, providedStore?: StateStore, storageContext: StorageRequestContext = createStorageRequestContext()) {
  return (await readFlowView(id, undefined, providedStore, storageContext)).record;
}
/** The hosted flow and the ID session view in one snapshot, for the server-rendered flow page. */
export async function readFlowView(id: string, walletSession: string | undefined, providedStore?: StateStore, storageContext: StorageRequestContext = createStorageRequestContext()) {
  const store = providedStore ?? await getStore(storageContext);
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error("Invalid wallet request");
  const view = await scopedStore(store, { session: walletSession, challenges: [hash(id)] }).read(s => ({ record: s.challenges[hash(id)], session: sessionSnapshot(accountFor(s, walletSession), true) }));
  if (!view.record?.hostedFlow || view.record.expires <= Date.now()) throw new AppError(ErrorCode.WalletRequestExpired);
  return view;
}
export async function handleService(request: NextRequest, providedStore?: StateStore, storageContext: StorageRequestContext = createStorageRequestContext()) {
  const timings = serviceTimings(storageContext);
  try {
    if (!checkServiceSecret(request.headers.get("x-dya-service-secret"))) return json({ error: "Unauthorized wallet client" }, 403);
    let store = providedStore ?? await getStore(storageContext);
    const raw = await request.text(); if (raw.length > 24000) return json({ error: "Request too large" }, 413);
    const input = z.object({ operation: z.enum(["request", "flow", "exchange", "receipt"]), path: z.string().max(256).optional(), body: z.unknown().optional(), session: z.string().max(256).optional(), flowId: z.string().optional(), code: z.string().optional(), verifier: z.string().optional(), approvalFlow: z.object({ verifierHash: flowInput.shape.verifierHash }).optional() }).parse(JSON.parse(raw));
    store = scopedStore(store, { session: input.session, challenges: input.flowId ? [hash(input.flowId)] : [] });
    const config = bridgeConfig();
    if (input.operation === "exchange") {
      if (!input.flowId || !input.code || !input.verifier) throw new Error("Invalid callback");
      const record = await readFlow(input.flowId, store), f = record.hostedFlow!;
      if (f.kind !== "connect" || f.status !== "complete" || f.codeHash !== hash(input.code!) || f.verifierHash !== createHash("sha256").update(input.verifier).digest("base64url")) throw new Error("Invalid or consumed callback");
      const session = open(f.session!);
      // Consume the flow and read the new grant's account in one guarded snapshot.
      const state = await scopedStore(store, { session, challenges: [hash(input.flowId)] }).transaction(s => { const current = s.challenges[hash(input.flowId!)]; if (!current || current.expires <= Date.now() || current.hostedFlow?.kind !== "connect" || current.hostedFlow.status !== "complete" || current.hostedFlow.codeHash !== hash(input.code!) || current.hostedFlow.verifierHash !== createHash("sha256").update(input.verifier!).digest("base64url")) throw new Error("Callback already consumed"); delete s.challenges[hash(input.flowId!)]; return sessionSnapshot(accountFor(s, session), true); });
      return json({ session, state });
    }
    // The grant's snapshot also admits its account for the wallet request below and answers that request's first reads.
    const granted = input.session ? await timings.measure("grant", async () => {
      const held = await heldSnapshot(store);
      return { held, ...await held.read(s => ({ grant: s.sessions[hash(input.session!)], admission: { account: accountFor(s, input.session) } })) };
    }) : undefined;
    const grant = granted?.grant;
    if (input.session && (!grant || grant.expires <= Date.now() || grant.clientOrigin !== config.clientOrigin)) { if (input.path === "state") return json({ account: null, passkeyOrigin: config.wallet.origin }); throw new AppError(ErrorCode.WalletConnectionExpired); }
    if (input.operation === "flow") {
      const data = flowInput.parse(input.body);
      const id = token();
      let f: HostedFlow = { kind: data.action, connectionKind: data.kind, clientOrigin: config.clientOrigin, callback: config.callback, verifierHash: data.verifierHash, status: "pending" };
      let expires = Date.now() + 300000;
      if (data.action === "approval") {
        if (!input.session || !grant?.ceremony || !data.challenge) throw new AppError(ErrorCode.PrepareThisOperationAgainBeforeConfirming);
        store = scopedStore(store, { session: input.session, challenges: [hash(grant.ceremony!)] });
        const approval = await store.read(s => {
          const c = s.challenges[hash(grant.ceremony!)];
          if (c?.value !== data.challenge) throw new AppError(ErrorCode.ApprovalDoesNotMatchThePreparedOperation);
          return approvalFlow(s, grant, c, data.verifierHash, input.session!, grant.ceremony!);
        });
        f = { ...approval.flow, connectionKind: data.kind };
        expires = approval.expires;
      }
      await store.transaction(s => { s.challenges[hash(id)] = { value: id, purpose: "hosted-flow", expires, ...(grant ? { accountId: grant.accountId } : {}), hostedFlow: f }; });
      return json({ flowId: id, url: `${config.wallet.origin}/flow/${id}`, expires });
    }
    if (input.operation === "receipt") {
      if (!input.session || !input.flowId) throw new Error("Missing approval receipt");
      const f = (await readFlow(input.flowId, store)).hostedFlow!;
      if (f.kind !== "approval" || !f.session || open(f.session) !== input.session || f.submitRoute !== input.path || f.status !== "complete" || !f.result) throw new Error("Approval is not completed for this operation");
      return json(f.result.body, f.result.status);
    }
    if (input.path === "connection/revoke") {
      if (input.session && grant) await store.transaction(s => { delete s.sessions[hash(input.session!)]; });
      return json({ ok: true });
    }
    const route = input.path?.split("?")[0];
    if (!input.path || !/^[a-z][a-z0-9/-]*(\?[^#]*)?$/.test(input.path) || (route!.startsWith("auth/") || route!.startsWith("recovery/")) || route!.includes("/submit") || /\/(verify|unlock)$/.test(route!)) throw new Error("Use DYA ID to authorize this operation");
    if (!input.session && !["state", "catalog", "token-icons", "network-icons", "bridge/routes", "bridge/deposits"].includes(route!)) throw new AppError(ErrorCode.ConnectYourDYAWalletFirst);
    const account = granted?.admission.account;
    // A hosted approval flow for a ceremony whose challenge is at hand. Its review needs no other
    // record unless it funds an order or converts a funding batch, which the request changed.
    const offer = (ceremony: string, prepared: Challenge | undefined) => {
      const id = token();
      let approval: ReturnType<typeof approvalFlow> | undefined;
      if (input.approvalFlow && input.session && prepared && !prepared.funding && !prepared.fundingBatchId && account && grant) try { approval = approvalFlow({ accounts: { [account.id]: account } }, grant, prepared, input.approvalFlow.verifierHash, input.session, ceremony); } catch { /* no flow: the client asks for one */ }
      return approval && grant ? { flow: { id: hash(id), challenge: { value: id, purpose: "hosted-flow" as const, expires: approval.expires, accountId: grant.accountId, hostedFlow: approval.flow } }, walletFlow: { flowId: id, url: `${config.wallet.origin}/flow/${id}`, expires: approval.expires } } : undefined;
    };
    // A workflow that takes the binder names its new ceremony on the grant, and stores the hosted
    // approval flow when asked for one, in the write that saves the ceremony's challenge.
    const bound: { ceremony?: string; walletFlow?: { flowId: string; url: string; expires: number } } = {};
    const bind: CeremonyBinder | undefined = input.session && grant ? (ceremony, challenge) => {
      const offered = offer(ceremony, challenge);
      return { sessionId: hash(input.session!), flow: offered?.flow, stored: written => { bound.ceremony = ceremony; bound.walletFlow = written.flow ? offered?.walletFlow : undefined; } };
    } : undefined;
    const result = await timings.measure("handler", () => walletRequest(input.path!, input.body, input.session, grant?.ceremony, providedStore ? store : undefined, storageContext, granted && { ...granted.admission, held: granted.held, bind }));
    const ceremony = result.cookies.get(CEREMONY)?.value;
    let walletFlow: { flowId: string; url: string; expires: number } | undefined;
    if (ceremony && input.session && bound.ceremony === ceremony) walletFlow = result.ok ? bound.walletFlow : undefined;
    else if (ceremony && input.session) {
      const session = input.session;
      // The challenge the wallet just saved for this ceremony.
      const prepared = input.approvalFlow && result.ok ? preparedChallenges.get(result) : undefined;
      const approvalNeedsState = !!input.approvalFlow && result.ok && (!prepared || !!prepared.funding || !!prepared.fundingBatchId || !account || !grant);
      // Binding the new ceremony to the grant and, when asked, creating its hosted approval flow
      // with it saves the client a separate flow request before ID can open.
      walletFlow = await timings.measure("bind", async () => {
        if (store.bindCeremony && !approvalNeedsState) {
          // One command: nothing here depends on a snapshot, and the batch itself checks that the
          // grant and the ceremony's challenge still exist.
          const offered = offer(ceremony, prepared);
          const stored = await store.bindCeremony(hash(session), ceremony, offered && { ...offered.flow, ceremonyId: hash(ceremony) });
          return stored.flow ? offered?.walletFlow : undefined;
        }
        return scopedStore(store, { session, challenges: [hash(ceremony)] }).transaction(s => {
          const current = s.sessions[hash(session)];
          if (!current) return undefined;
          current.ceremony = ceremony;
          if (!input.approvalFlow || !result.ok) return undefined;
          let approval: ReturnType<typeof approvalFlow>;
          try { approval = approvalFlow(s, current, s.challenges[hash(ceremony)], input.approvalFlow.verifierHash, session, ceremony); }
          catch { return undefined; }
          const id = token();
          s.challenges[hash(id)] = { value: id, purpose: "hosted-flow", expires: approval.expires, accountId: current.accountId, hostedFlow: approval.flow };
          return { flowId: id, url: `${config.wallet.origin}/flow/${id}`, expires: approval.expires };
        });
      });
    }
    const body: unknown = await result.json();
    // Service clients receive JSON only, never wallet-host cookies.
    const relayed = relayWalletResponse(walletFlow && body && typeof body === "object" ? { ...body, walletFlow } : body, result);
    relayed.headers.set("Server-Timing", timings.header(result.headers.get("Server-Timing")));
    // The wall-clock span of this request here: Terminal splits its own wait into the way here and the way back.
    relayed.headers.set("X-DYA-Service-Clock", `${timings.startedAt},${Date.now()}`);
    return relayed;
  } catch (error) { return errorResponse(request, "service", error); }
}
export async function completeConnection(id: string, walletSession: string | undefined, providedStore?: StateStore, storageContext: StorageRequestContext = createStorageRequestContext()) {
  const store = scopedStore(providedStore ?? await getStore(storageContext), { session: walletSession, challenges: [hash(id)] });
  const record = await readFlow(id, store), flow = record.hostedFlow!;
  if (flow.kind !== "connect" || flow.status !== "pending") throw new AppError(ErrorCode.ConnectionAlreadyCompleted);
  const account = await store.read(s => accountFor(s, walletSession));
  if (!account) throw new AppError(ErrorCode.SignInWithYourPasskeyFirst);
  const grant = token(), code = token();
  await store.transaction(s => {
    const current = s.challenges[hash(id)];
    if (current?.hostedFlow?.status !== "pending" || accountFor(s, walletSession)?.id !== account.id) throw new AppError(ErrorCode.WalletSessionChanged);
    s.sessions[hash(grant)] = { accountId: account.id, expires: Date.now() + SESSION_AGE * 1000, clientOrigin: flow.clientOrigin };
    transferConfidentialSession(s, walletSession!, grant);
    current.accountId = account.id;
    current.hostedFlow = { ...flow, status: "complete", session: seal(grant), codeHash: hash(code) };
  });
  return { code, callback: flow.callback, clientOrigin: flow.clientOrigin };
}
export async function completeApproval(id: string, assertion: unknown, providedStore?: StateStore, storageContext: StorageRequestContext = createStorageRequestContext()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error("Invalid wallet request");
  const store = scopedStore(providedStore ?? await getStore(storageContext), { challenges: [hash(id)] });
  // Validate the flow and claim it in one fresh, guarded snapshot.
  const f = await store.transaction(s => {
    const current = s.challenges[hash(id)];
    if (!current?.hostedFlow || current.expires <= Date.now()) throw new AppError(ErrorCode.WalletFlowExpired);
    const flow = current.hostedFlow;
    if (flow.kind !== "approval" || !flow.session || !flow.ceremony || !flow.submitRoute) throw new Error("Invalid approval flow");
    if (flow.status !== "pending") throw new AppError(ErrorCode.ApprovalAlreadyStarted);
    flow.status = "running";
    return { ...flow, session: flow.session, ceremony: flow.ceremony, submitRoute: flow.submitRoute };
  });
  const result = await walletRequest(f.submitRoute, assertion, open(f.session), open(f.ceremony), providedStore ? store : undefined, storageContext);
  const body = await result.json();
  if (result.status === 503) {
    // Preserve running: an unavailable persistence/provider result is not proof of nonexecution.
    return { status: result.status, body, retryAfter: result.headers.get("Retry-After") ?? "1", clientOrigin: f.clientOrigin, callback: f.callback };
  }
  await store.transaction(s => { const current = s.challenges[hash(id)]; if (current?.hostedFlow) { current.hostedFlow = { ...current.hostedFlow, status: "complete", result: { status: result.status, body } }; current.expires = Date.now() + SESSION_AGE * 1000; } });
  return { status: result.status, body, clientOrigin: f.clientOrigin, callback: f.callback };
}
