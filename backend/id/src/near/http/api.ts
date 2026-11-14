import { DYA_WALLET_NAMES } from "@dya/config";
import { accountIdentity } from "../auth/intents";
import { readDepositStatus } from "../services/one-click-deposit";
import { runSendPolicy } from "../services/outlayer-send-policy";
import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { baseUsdc, cancelOutlayerLimitOrder, readOutlayerOpenOrders, readOutlayerTradingActivity, readOutlayerTradingBalances, tradingDeposit } from "../outlayer/setup-draft";
import { isLegacyTradingAccount, selectedTradingAccount, tradingAccountsView } from "../outlayer/accounts";
import { activationStatus } from "../services/outlayer-activation-workflow";
import { readOutlayerSetup, runOutlayerSetup } from "../services/outlayer-setup-workflow";
import { submitFeedback } from "../services/feedback";
import { depositNetworkAllowed } from "../services/deposit-refund-policy";

import { runRecovery } from "../services/recovery-workflow";
import { errorResponse } from "./storage-response";
import { createStorageRequestContext, type StorageRequestContext } from "../repositories/request-budget";
import { routePattern } from "../../../../../packages/wallet-contracts/src/http/error-response";
import { privateLiveBalances, runConfidential } from "../services/confidential-workflow";
import { runFundingConversions } from "../services/funding-conversions-workflow";
import { readBridgeRoutes } from "../providers/bridge";
import { discoverTokens } from "../services/token-policy";
import { applyTokenMetadata, tokenAllowed } from "../../../../../packages/wallet-contracts/src/domain/token-registry";
import { discoverNetworks } from "../services/network-policy";
import { readTokenIcons } from "../providers/token-icons";
import { readCatalog, resolvePair } from "../providers/catalog";

import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";

import { getDeploymentConfig } from "../../deployment/config";
import { checkInternalAccess } from "../../deployment/access";
import { handleNearRead } from "./api-reads";
import { readBalances } from "../providers/live";


import { DEFAULT_PAIR } from "../../../../../packages/wallet-contracts/src/domain/catalog";

import { simulateProbe } from "../auth/intents";

import { NextRequest, NextResponse } from "next/server";

import { getStore, scopedStore, hash, accountFor, type StateStore } from "../repositories/store";

import { SESSION, CEREMONY, admitAccount, preparedChallenges, requireAccount, type ServiceAdmission, type WorkflowResult } from "../services/workflow-context";
import { runAuthentication } from "../services/authentication-workflow";
import { runMarketTrades } from "../services/market-trades-workflow";
import { runLimitOrders } from "../services/limit-orders-workflow";
import { runTransfers } from "../services/transfers-workflow";
import { runBackup } from "../services/backup-workflow";
import { runSigningProbe } from "../services/signing-probe-workflow";
function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** `accountMs`: admitting the session's account, reported after the workflow's own stages. */
function workflowResponse(result: WorkflowResult, accountMs?: number) {
  const res = response(result.body, result.status);
  const timing = [result.headers?.["Server-Timing"], accountMs === undefined ? undefined : `id_account;dur=${Math.round(accountMs * 10) / 10}`].filter(Boolean).join(", ");
  if (timing) res.headers.set("Server-Timing", timing);
  for (const cookie of result.cookies) res.cookies.set(cookie.name, cookie.value, cookie.options);
  if (result.challenge) preparedChallenges.set(res, result.challenge);
  return res;
}
export async function handleNear(
  request: NextRequest,
  path: string[],
  providedStore?: StateStore,
  simulator = simulateProbe,
  balanceReader = readBalances,
  analyzeEntry?: (asset: Awaited<ReturnType<typeof readCatalog>>[number]) => Promise<unknown>,
  storageContext: StorageRequestContext = createStorageRequestContext(),
  /** The service's admission of this session, read in the same snapshot as its grant, with what else it hands the request. */
  admitted?: ServiceAdmission,
) {
  try {
    const blocked = checkInternalAccess(request);
    if (blocked) return blocked;
    const deployment = getDeploymentConfig();
    const route = path.join("/");

    let store = providedStore ?? await getStore(storageContext);
    const url = new URL(request.url);
    const session = request.cookies.get(SESSION)?.value;
    const ceremony = request.cookies.get(CEREMONY)?.value;
    if (["state", "live/balances", "confidential/prepare", "confidential/unlock", "confidential/balances"].includes(route)) {
      store = scopedStore(store, { session, challenges: ceremony ? [hash(ceremony)] : [], rateLimit: route === "confidential/prepare" });
    }
    let balanceAccount: Awaited<ReturnType<typeof requireAccount>> | undefined;
    // Every production balance read is session-authenticated and private. The
    // injected reader is retained only for isolated API tests.
    if (!providedStore) balanceReader = async (identity, _fetcher, assets) => {
      const owner = balanceAccount ?? await requireAccount(store, session);
      return privateLiveBalances(store, session, owner.id, identity, assets, admitted?.held);
    };
    if (route === "bridge/address")
      return response({ error: "This operation is not available for confidential accounts. Public execution is disabled." }, 400);
    if (route === "bridge/deposits") return response({ deposits: [] });

    async function handleTradingDeposit(input: { amount: string } | { id: string }) {
      const account = await requireAccount(store, session);
      const id = url.searchParams.get("account");
      if (!id || !tradingAccountsView(account).wallets.some(wallet => wallet.id === id)) {
        return response({ error: "Trading account unavailable" }, 404);
      }
      const draft = selectedTradingAccount(account, id).outlayerSetupDraft;
      if (draft?.phase !== "policy-ready") return response({ error: "Trading deposit unavailable" }, 503);
      try {
        return response(await tradingDeposit(account.id, draft, input));
      } catch {
        return response({ error: "Trading deposit unavailable" }, 502);
      }
    }

    if (request.method === "GET") {
      if (route === "outlayer/deposit-status") {
        const id = url.searchParams.get("id");
        if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return response({ error: "Invalid deposit ID" }, 400);
        return handleTradingDeposit({ id });
      }
      if (route === "outlayer/trading-balances" || route === "outlayer/trading-activity" || route === "outlayer/open-orders") {
        const activity = route === "outlayer/trading-activity";
        const unavailable = activity ? "Trading activity unavailable" : "Trading balances unavailable";
        const account = await requireAccount(store, session);
        const id = url.searchParams.get("account");
        if (!id || !tradingAccountsView(account).wallets.some(wallet => wallet.id === id)) {
          return response({ error: "Trading account unavailable" }, 404);
        }
        const selected = selectedTradingAccount(account, id);
        const draft = selected.outlayerSetupDraft;
        if (draft?.phase !== "policy-ready") return response({ error: unavailable }, 503);
        try {
          if (route === "outlayer/open-orders") {
            try {
              return response({ orders: await readOutlayerOpenOrders(account.id, draft) });
            } catch (error) {
              const message = error instanceof Error && error.message.startsWith("OutLayer returned") ? error.message : "Trading limit orders unavailable.";
              return response({ error: message }, 502);
            }
          }
          if (!activity) return response({ balances: await readOutlayerTradingBalances(account.id, draft) });
          const [requests, deposits, incoming] = await Promise.all([
            readOutlayerTradingActivity(account.id, draft, fetch, { includeAll: true }),
            store.read(state => Object.values(state.deposits ?? {}).filter(deposit =>
              deposit.ownerId === account.id && deposit.quote.recipient === draft.walletPublicKey && deposit.status === "SUCCESS")),
            store.read(state => Object.values(state.withdrawals ?? {}).filter(transfer =>
              transfer.ownerId === account.id && transfer.review.confidentiality === "advanced" &&
              transfer.review.destinationChain === "Confidential Intents" &&
              transfer.review.destinationWallet === draft.walletPublicKey && transfer.state !== "failed")
              .sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)),
          ]);
          const incomingStatuses = await Promise.allSettled(incoming.map(async transfer => {
            const status = await readDepositStatus({ depositAddress: transfer.review.depositAddress }, process.env.ONE_CLICK_JWT ?? "");
            if (status.status !== "SUCCESS") return null;
            return {
              id: transfer.id, createdAt: transfer.createdAt, status: "SUCCESS",
              counterpartyName: DYA_WALLET_NAMES.main,
              counterpartyAvatarSeed: accountIdentity(account).accountId,
              counterpartyIsTrading: false,
              creditedAmount: status.creditedAmount, originChainTxHashes: status.destinationChainTxHashes,
              quote: {
                asset: transfer.review.asset, sourceChain: "Confidential Intents",
                sourceAssetId: transfer.review.destinationAsset,
              },
            };
          }));
          const incomingDeposits = incomingStatuses.flatMap(result =>
            result.status === "fulfilled" && result.value ? [result.value] : []);
          const records = isLegacyTradingAccount(account, id) ? account.outlayerLegacySetup : account.outlayerTradingAccounts?.[id];
          const mainRecipient = accountIdentity(account).accountId;
          const destinations = new Map(tradingAccountsView(account).wallets.flatMap(wallet => {
            const target = selectedTradingAccount(account, wallet.id).outlayerSetupDraft;
            return target?.phase === "policy-ready" ? [[target.walletPublicKey, wallet] as const] : [];
          }));
          const tradingSources = [
            ...Object.values(account.outlayerTradingAccounts ?? {}),
            { ...account.outlayerLegacySetup, id: account.outlayerSetupDraft && ("walletId" in account.outlayerSetupDraft ? account.outlayerSetupDraft.walletId : account.outlayerSetupDraft.id), name: DYA_WALLET_NAMES.legacyTrading },
          ];
          for (const source of tradingSources) {
            for (const transfer of Object.values(source.withdrawals ?? {})) {
              if (transfer.phase !== "complete" || transfer.outcome !== "settled" ||
                  !transfer.internal || transfer.recipient !== draft.walletPublicKey ||
                  !transfer.assetId || !transfer.symbol || transfer.decimals === undefined) continue;
              incomingDeposits.push({
                id: transfer.id,
                createdAt: Date.parse(transfer.deadline) - 120_000,
                status: "SUCCESS",
                counterpartyName: source.name,
                counterpartyAvatarSeed: source.id ?? source.name,
                counterpartyIsTrading: true,
                creditedAmount: new D(transfer.rawAmount).div(new D(10).pow(transfer.decimals)).toFixed(),
                originChainTxHashes: [],
                quote: { asset: transfer.symbol, sourceChain: "Confidential Intents", sourceAssetId: transfer.assetId },
              });
            }
          }
          const matched = new Set<string>();
          const withdrawals = Object.values(records?.withdrawals ?? {}).flatMap(operation => {
            if (operation.draftId !== draft.id || !("requestId" in operation)) return [];
            const request = requests.find(item => item.request_id === operation.requestId);
            if (!request) return [];
            matched.add(operation.requestId);
            if (operation.phase === "awaiting-approval" && ["pending_approval", "rejected"].includes(request.status)) return [];
            const state = operation.phase === "complete" ? operation.outcome
              : request.status === "success" ? "settled"
              : ["failed", "refunded", "rejected"].includes(request.status) ? "failed"
              : request.status === "needs_review" ? "unknown" : "submitted";
            return [{
              counterpartyIsTrading: !!operation.internal && destinations.has(operation.recipient),
              counterpartyAvatarSeed: operation.internal
                ? operation.recipient === mainRecipient ? mainRecipient : destinations.get(operation.recipient)?.id
                : undefined,
              counterpartyName: operation.internal
                ? operation.recipient === mainRecipient ? DYA_WALLET_NAMES.main : destinations.get(operation.recipient)?.name
                : undefined,
              id: operation.id, requestId: operation.requestId, createdAt: Date.parse(request.created_at),
              state, amount: new D(operation.rawAmount).div(new D(10).pow(operation.decimals ?? 6)).toFixed(),
              asset: operation.symbol ?? "USDC", network: operation.internal ? "confidential" : "base", chain: operation.internal ? "Confidential Intents" : "Base", assetId: operation.assetId ?? baseUsdc, address: operation.recipient,
            }];
          });
          return response({ withdrawals, requests: requests.filter(item =>
            !matched.has(item.request_id) && ["transfer", "withdraw", "deposit", "swap"].includes(item.type)), deposits: [...incomingDeposits, ...deposits.map(({ id, createdAt, status, creditedAmount, originChainTxHashes, quote }) => ({
            id, createdAt, status, creditedAmount, originChainTxHashes,
            quote: { asset: quote.asset, sourceNetwork: quote.sourceNetwork, sourceChain: quote.sourceChain, sourceAssetId: quote.sourceAssetId },
          }))] });
        } catch {
          return response({ error: unavailable }, 502);
        }
      }
      if (route === "outlayer/activation/status") return response(activationStatus(selectedTradingAccount(await requireAccount(store, session), url.searchParams.get("account")), deployment.hosted, url.searchParams.get("account")));
      if (route === "outlayer/setup") return response({ setup: await readOutlayerSetup(selectedTradingAccount(await requireAccount(store, session), url.searchParams.get("account"))) });
      if (route === "network-icons") return response(await store.read(s => ({ icons: Object.fromEntries(Object.values(s.networks ?? {}).filter(n => n.iconUrl).map(n => [n.id, n.iconUrl])), names: Object.fromEntries(Object.values(s.networks ?? {}).map(n => [n.id, n.name])) })));
      if (route === "token-icons") { const icons = await readTokenIcons(); return response({ icons: await store.read(s => ({ ...icons, ...Object.fromEntries(Object.values(s.tokens ?? {}).filter(t => t.iconUrl).map(t => [t.id, t.iconUrl])) })) }); }
      if (route === "bridge/routes") {
        const registry = await store.read(s => Object.values(s.networks ?? {}));
        const routes = await readBridgeRoutes(fetch, readCatalog, registry);
        return response({ routes: await store.read(s => routes.filter(r => depositNetworkAllowed(s, s.networks?.[r.asset.blockchain]) && tokenAllowed(r.asset, s.tokens?.[r.asset.assetId], "deposits"))) });
      }
      if (route === "catalog" || route === "metadata-catalog") {
        const assets = await readCatalog();
        await discoverNetworks(store, assets);
        await discoverTokens(store, assets);
        if (route === "metadata-catalog") return response(await store.read(s => ({ assets: applyTokenMetadata(assets, Object.values(s.tokens ?? {})).map(asset => ({ ...asset, trading: tokenAllowed(asset, s.tokens?.[asset.assetId], "trading") })) })));
        return response({ assets: await store.read(s => applyTokenMetadata(assets, Object.values(s.tokens ?? {}))), tokens: await store.read(s => Object.values(s.tokens ?? {}).map(({ reviewedBy: _reviewedBy, ...t }) => t)), networks: await store.read(s => Object.values(s.networks ?? {}).map(({ reviewedBy: _reviewedBy, ...n }) => ({ ...n, deposits: depositNetworkAllowed(s, n) }))) });
      }
      if (route === "live/balances") balanceAccount = admitted ? admitAccount(admitted.account) : await requireAccount(store, session);
      const selected = route === "live/balances" && (url.searchParams.has("baseAssetId") || url.searchParams.has("quoteAssetId"))
        ? await resolvePair(Object.fromEntries(url.searchParams)) : undefined;
      const allAssets = route === "live/balances" && url.searchParams.get("all") === "true" ? await readCatalog() : undefined;
      const reader = allAssets ? (id: string) => balanceReader(id, undefined, allAssets) : selected ? (id: string) => balanceReader(id, undefined, [selected.base, selected.quote]) : balanceReader;
      const read = await handleNearRead(route, store, session, reader, balanceAccount);
      if (read) return read;
    }
    if (request.method !== "POST") return response({ error: "Not found" }, 404);
    if (
      request.headers.get("origin") !==
        deployment.origin ||
      !request.headers.get("content-type")?.startsWith("application/json")
    )
      return response({ error: "Same-origin JSON request required" }, 403);
    if (Number(request.headers.get("content-length") ?? 0) > 20000)
      return response({ error: "Request too large" }, 413);
    const rawBody = await request.text();
    if (rawBody.length > 20000)
      return response({ error: "Request too large" }, 413);
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError(ErrorCode.InvalidRequest);
    if (route === "outlayer/cancel-limit-order") {
      const account = await requireAccount(store, session);
      const id = url.searchParams.get("account");
      if (!id || !tradingAccountsView(account).wallets.some(wallet => wallet.id === id)) {
        return response({ error: "Trading account unavailable" }, 404);
      }
      const draft = selectedTradingAccount(account, id).outlayerSetupDraft;
      if (draft?.phase !== "policy-ready") return response({ error: "Trading account unavailable" }, 503);
      if (typeof body.orderId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.orderId)) {
        return response({ error: "Invalid order ID" }, 400);
      }
      try {
        return response(await cancelOutlayerLimitOrder(account.id, draft, body.orderId));
      } catch {
        return response({ error: "Cancellation status unavailable. Check the order before retrying." }, 502);
      }
    }
    if (route === "outlayer/deposit") {
      if (typeof body.amount !== "string" || !/^[1-9][0-9]{6,17}$/.test(body.amount)) return response({ error: "Invalid deposit amount" }, 400);
      return handleTradingDeposit({ amount: body.amount });
    }
    if (
      route.startsWith("auth/") &&
      route !== "auth/logout" &&
      url.hostname !== deployment.rpId
    )
      throw new AppError(ErrorCode.PasskeyOriginRequired, deployment.origin);
    if (route === "feedback") { const result = await submitFeedback(store, session, body); return response(result.body, result.status); }
    const context = { route, body, store, deployment, url, session, ceremony, simulator, balanceReader, held: admitted?.held, bind: admitted?.bind };
    const recovery = await runRecovery(context);
    if (recovery) return workflowResponse(recovery);
    const auth = await runAuthentication(context);
    if (auth) return workflowResponse(auth);
    if (route === "analysis/entry") {
      const assetId = body.assetId ?? DEFAULT_PAIR.base.assetId;
      if (typeof assetId !== "string") throw new AppError(ErrorCode.InvalidRequest);
      const asset = (await readCatalog()).find(item => item.assetId === assetId);
      if (!asset) throw new AppError(ErrorCode.UnsupportedMarketCapability);
      if (!analyzeEntry) return response({ error: "Analysis belongs to DYA Terminal" }, 404);
      return response(await analyzeEntry(asset));
    }
    const accountStarted = performance.now();
    const found = admitted ?? await store.read(s => ({ account: accountFor(s, session) }));
    const account = admitAccount(found.account);
    // Balance reads for this request belong to the account just admitted.
    balanceAccount = account;
    const accountMs = performance.now() - accountStarted;
    const owned = { ...context, account };
    const result = await runSendPolicy(owned)
      ?? await runOutlayerSetup(owned)
      ?? await runConfidential(owned)
      ?? await runFundingConversions(owned)
      ?? await runMarketTrades(owned)
      ?? await runLimitOrders(owned)
      ?? await runTransfers(owned)
      ?? await runBackup(owned)
      ?? await runSigningProbe(owned)
      ?? null;
    return result ? workflowResponse(result, accountMs) : response({ error: "Not found" }, 404);
  } catch (error) {
    return errorResponse(request, routePattern(path.join("/")), error);
  }
}
