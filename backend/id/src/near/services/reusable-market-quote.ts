import { validateExecutableMarketTrade, type ExecutableMarketQuote, type ExecutableMarketTrade } from './market-execution';
import type { FeePlan } from '../../../../../packages/wallet-contracts/src/domain/trading-fees';
import type { SelectedPair } from '../../../../../packages/wallet-contracts/src/domain/catalog';
import type { LiveBalances } from '../../../../../packages/wallet-contracts/src/domain/assets';
import { balanceFor } from '../../../../../packages/wallet-contracts/src/domain/assets';
import { D } from '../../../../../packages/wallet-contracts/src/domain/decimal';
import { AppError, ErrorCode } from '../../../../../packages/wallet-contracts/src/domain/errors';
import { accountFor, hash, type StateStore } from '../repositories/store';
import { admitAccount, token } from './workflow-context';
import { marketSize } from './one-click-market';
import { selectMarketSlippage } from './slippage';
import { requireCurrentFeePlan } from './trading-fees';
import { requireTradingPair } from "./token-policy";

export function marketQuoteMatches(quote: ExecutableMarketQuote, body: Record<string, unknown>, pair: SelectedPair, feePlan: FeePlan | undefined, now = Date.now()) {
  try {
    if (!Number.isFinite(Date.parse(quote.expiresAt)) || quote.side !== body.side || quote.confidentiality !== 'advanced' || quote.shortfall !== '0' || Date.parse(quote.expiresAt) <= now + 15_000) return false;
    if (quote.pair?.base.assetId !== pair.base.assetId || quote.pair.base.decimals !== pair.base.decimals || quote.pair.quote.assetId !== pair.quote.assetId || quote.pair.quote.decimals !== pair.quote.decimals) return false;
    const size = marketSize(body, pair), slippage = selectMarketSlippage(body.slippage);
    if (quote.swapType !== (size.exactInput ? "EXACT_INPUT" : "EXACT_OUTPUT") || size.amount !== (size.exactInput ? quote.inputRaw : quote.outputRaw) || slippage.bps !== quote.slippageBps || slippage.policy.mode !== quote.slippagePolicy?.mode) return false;
    const previous = quote.feeReceipt?.plan;
    return (!previous && !feePlan) || (!!previous && !!feePlan && previous.kind === feePlan.kind && previous.revision === feePlan.revision && previous.maxTotalBps === feePlan.maxTotalBps && previous.recipient === feePlan.recipient && previous.requestedDyaBps === feePlan.requestedDyaBps);
  } catch { return false; }
}

const REFERENCE = /^[A-Za-z0-9_-]{43}$/;
/** A stored quote's record: the reference is only meaningful within its own session. */
const quoteId = (sessionId: string, reference: string) => hash(`market-quote:${sessionId}:${reference}`);

/**
 * At most one encrypted, non-authorizing quote per session. Never touches the active ceremony.
 * `reference`: the ticket names one for each input and sends it with every quote of that input
 * (the quick one, the full one requested alongside, later refreshes). They take each other's place
 * under it, so a Review that holds the reference claims whichever is stored and never races a
 * replacement. Of one input's quotes the full-window one outlives the quick one, whichever arrives
 * first; otherwise a quote requested before the session's quote never replaces it (`requestedAt`:
 * when the request arrived), so a slow request for an earlier input cannot displace a later one's.
 */
export async function saveMarketQuote(store: StateStore, session: string | undefined, accountId: string, quote: ExecutableMarketQuote, prepared?: ExecutableMarketTrade, request: { reference?: unknown; quick?: boolean; requestedAt?: number } = {}) {
  if (!session || quote.shortfall !== '0') return undefined;
  const sessionId = hash(session), requestedAt = request.requestedAt ?? Date.now(), quick = request.quick === true;
  const reference = typeof request.reference === 'string' && REFERENCE.test(request.reference) ? request.reference : token();
  const id = quoteId(sessionId, reference);
  return store.transaction(s => {
    if (admitAccount(accountFor(s, session)).id !== accountId) throw new AppError(ErrorCode.SessionChanged);
    requireTradingPair(s, quote.pair);
    requireCurrentFeePlan(s, quote.feeReceipt?.plan, 'market');
    const owner = s.sessions[sessionId];
    const held = owner.marketQuoteId ? s.challenges[owner.marketQuoteId] : undefined;
    if (held?.purpose === "market-quote" && held.quoteSession === sessionId) {
      const heldQuick = held.quoteQuick === true;
      if (owner.marketQuoteId === id && heldQuick !== quick ? quick : (held.quoteRequestedAt ?? 0) > requestedAt) return undefined;
      delete s.challenges[owner.marketQuoteId!];
    }
    owner.marketQuoteId = id;
    s.challenges[id] = { purpose: 'market-quote', value: 'market-quote', accountId, quoteSession: sessionId, quoteRequestedAt: requestedAt, ...(quick ? { quoteQuick: true } : {}), marketQuote: quote, ...(prepared ? { marketTrade: prepared } : {}), expires: Date.parse(quote.expiresAt) };
    return reference;
  });
}

/** Atomically claim a matching quote so overlapping Review requests cannot reuse it twice. */
export async function takeMarketQuote(store: StateStore, session: string | undefined, accountId: string, reference: unknown, body: Record<string, unknown>, pair: SelectedPair, feePlan: FeePlan | undefined, now = Date.now(), protocolAccountId?: string) {
  if (!session || typeof reference !== 'string' || !REFERENCE.test(reference)) return undefined;
  return store.transaction(s => {
    const sessionId = hash(session), id = quoteId(sessionId, reference), owner = s.sessions[sessionId], record = s.challenges[id];
    if (accountFor(s, session)?.id !== accountId || owner?.marketQuoteId !== id || record?.purpose !== 'market-quote' || record.accountId !== accountId || record.quoteSession !== sessionId || record.expires <= now + 15_000 || !record.marketQuote || (protocolAccountId !== undefined && record.marketQuote.accountId !== protocolAccountId) || !marketQuoteMatches(record.marketQuote, body, pair, feePlan, now)) return undefined;
    requireTradingPair(s, pair);
    requireCurrentFeePlan(s, record.marketQuote.feeReceipt?.plan, 'market');
    delete owner.marketQuoteId;
    delete s.challenges[id];
    return { quote: record.marketQuote, prepared: record.marketTrade };
  });
}

export function refreshMarketQuoteBalance(quote: ExecutableMarketQuote, balances: LiveBalances, accountId: string) {
  if (balances.accountId !== accountId || !quote.pair) throw new AppError(ErrorCode.SessionChanged);
  const asset = quote.side === 'buy' ? quote.pair.quote : quote.pair.base;
  const input = balanceFor(balances, asset.assetId, asset);
  if (new D(quote.inputRaw).gt(input.raw)) throw new AppError(ErrorCode.InsufficientExecutableBalance, asset.symbol);
  return { ...quote, available: input.amount, balanceBlock: balances.blockHeight };
}

/** Revalidate the warmed payload against the exact quote and the current protocol identity. */
export function reuseMarketSigningPayload(quote: ExecutableMarketQuote, prepared: ExecutableMarketTrade | undefined, accountId: string, now = Date.now()) {
  if (quote.accountId !== accountId || !Number.isFinite(Date.parse(quote.expiresAt)) || !prepared || !Number.isFinite(Date.parse(prepared.expiresAt)) || Date.parse(prepared.expiresAt) <= now + 15_000 || Date.parse(prepared.expiresAt) > Date.parse(quote.expiresAt)) return undefined;
  const terms = (value: ExecutableMarketQuote | ExecutableMarketTrade) => [value.confidentiality, value.orderType, value.side, value.quantity, value.pair, value.inputSymbol, value.outputSymbol, value.inputRaw, value.outputRaw, value.principal, value.estimatedOutput, value.minimumOutput, value.slippageBps, value.slippagePolicy, value.depositAddress, value.depositMemo, value.feeReceipt];
  if (JSON.stringify(terms(prepared)) !== JSON.stringify(terms(quote))) return undefined;
  try {
    validateExecutableMarketTrade(prepared, accountId, now);
    return { ...prepared, available: quote.available, balanceBlock: quote.balanceBlock };
  } catch { return undefined; }
}
