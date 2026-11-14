import { PRIVATE_VERIFIER, PRIVATE_SALT, privateAssetId } from "../../../packages/wallet-contracts/src/domain/confidential";
import { payloadChallenge, versionedNonce } from "../../../backend/id/src/near/auth/intents";
import type { ExecutableMarketTrade } from "../../../backend/id/src/near/services/market-execution";
// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PAIR, makePair } from '@/lib/near/domain/catalog';
import { emptyState, hash, type State, type StateStore } from '../../../backend/id/src/near/repositories/store';
import { marketQuoteMatches, saveMarketQuote, takeMarketQuote, refreshMarketQuoteBalance, reuseMarketSigningPayload } from '../../../backend/id/src/near/services/reusable-market-quote';
import { encodeFinancialRecord, decodeFinancialRecord } from '../../../backend/id/src/near/repositories/financial-history';
import { marketPreview } from '@/lib/near/http/schemas/trading';
import type { ExecutableMarketQuote } from '../../../backend/id/src/near/services/market-execution';
import { approvedTestTokens } from './fixtures/token-policy';
const accountId = 'alice', session = 'private-session';
const body = { side: 'buy', quantity: '0.029' };
let state: State, store: StateStore, quote: ExecutableMarketQuote;
beforeEach(() => {
  state = emptyState();
  state.accounts[accountId] = { id: accountId, kind: 'passkey', counter: 0 };
  state.sessions[hash(session)] = { accountId, expires: Date.now() + 600000, ceremony: 'active-ceremony' };
  state.challenges[hash('active-ceremony')] = { purpose: 'market-trade', value: 'active', accountId, expires: Date.now() + 600000 };
  state.tokens = Object.fromEntries(approvedTestTokens([DEFAULT_PAIR.base, DEFAULT_PAIR.quote]).map(t => [t.id, { ...t, trading: true, coingeckoIdOverride: "synthetic" }]));
  store = { read: fn => fn(state), transaction: fn => fn(state) };
  quote = { accountId, orderType: 'market', side: 'buy', submissionEnabled: true, confidentiality: 'advanced', pair: DEFAULT_PAIR,
    quantity: '0.029', inputSymbol: DEFAULT_PAIR.quote.symbol, outputSymbol: DEFAULT_PAIR.base.symbol,
    inputRaw: '110000', outputRaw: '29000000000000000000000', principal: '0.11', estimatedOutput: '0.029', minimumOutput: '0.028',
    available: '1', shortfall: '0', balanceBlock: 1, slippageBps: 30, slippagePolicy: { mode: 'default' },
    expiresAt: new Date(Date.now() + 120000).toISOString(), quoteExpiresAt: new Date(Date.now() + 120000).toISOString(), swapType: 'EXACT_OUTPUT',
    depositAddress: 'private-deposit-address', depositMemo: null };
});
afterEach(() => vi.unstubAllEnvs());
it('stores one quote per session without changing an active approval, and claims it once', async () => {
  await saveMarketQuote(store, session, accountId, quote);
  const second = await saveMarketQuote(store, session, accountId, quote);
  expect(Object.values(state.challenges).filter(c => c.purpose === 'market-quote')).toHaveLength(1);
  expect(state.sessions[hash(session)].ceremony).toBe('active-ceremony');
  expect(state.challenges[hash('active-ceremony')]).toBeDefined();
  const claims = await Promise.all([takeMarketQuote(store, session, accountId, second, body, DEFAULT_PAIR, undefined), takeMarketQuote(store, session, accountId, second, body, DEFAULT_PAIR, undefined)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(state.sessions[hash(session)].marketQuoteId).toBeUndefined();
});
it('holds an input\'s quotes under the reference the ticket names, the full one outliving the quick one', async () => {
  const reference = 'r'.repeat(43), full = { ...quote, minimumOutput: '0.0285' }, refreshed = { ...quote, minimumOutput: '0.0284' };
  expect(await saveMarketQuote(store, session, accountId, quote, undefined, { reference, quick: true, requestedAt: 1000 })).toBe(reference);
  // Both were requested together: the full quote's request may have arrived first.
  expect(await saveMarketQuote(store, session, accountId, full, undefined, { reference, requestedAt: 999 })).toBe(reference);
  expect(await saveMarketQuote(store, session, accountId, quote, undefined, { reference, quick: true, requestedAt: 1001 })).toBeUndefined();
  expect(await saveMarketQuote(store, session, accountId, quote, undefined, { reference, requestedAt: 998 })).toBeUndefined();
  expect(await saveMarketQuote(store, session, accountId, refreshed, undefined, { reference, requestedAt: 31000 })).toBe(reference);
  // A Review holding the reference since the quick quote claims the latest full one.
  expect((await takeMarketQuote(store, session, accountId, reference, body, DEFAULT_PAIR, undefined))?.quote).toEqual(refreshed);
  // The full quote landing after that claim is held for the next Review of the same input.
  expect(await saveMarketQuote(store, session, accountId, full, undefined, { reference, requestedAt: 999 })).toBe(reference);
  expect((await takeMarketQuote(store, session, accountId, reference, body, DEFAULT_PAIR, undefined))?.quote).toEqual(full);
});
it('never replaces the quote of a later input with one requested earlier', async () => {
  const later = 'l'.repeat(43);
  expect(await saveMarketQuote(store, session, accountId, quote, undefined, { reference: later, quick: true, requestedAt: 2000 })).toBe(later);
  // The earlier input's full-window quote arrives after the later input's quick one.
  expect(await saveMarketQuote(store, session, accountId, { ...quote, minimumOutput: '0.0285' }, undefined, { reference: 'e'.repeat(43), requestedAt: 1000 })).toBeUndefined();
  expect((await takeMarketQuote(store, session, accountId, later, body, DEFAULT_PAIR, undefined))?.quote).toEqual(quote);
});
it('binds references to their exact session and account', async () => {
  const reference = await saveMarketQuote(store, session, accountId, quote);
  state.sessions[hash('other-session')] = { accountId, expires: Date.now() + 600000 };
  expect(await takeMarketQuote(store, 'other-session', accountId, reference, body, DEFAULT_PAIR, undefined)).toBeUndefined();
  expect(await takeMarketQuote(store, session, 'other-account', reference, body, DEFAULT_PAIR, undefined)).toBeUndefined();
  expect(await takeMarketQuote(store, session, accountId, reference, body, DEFAULT_PAIR, undefined)).toEqual({ quote, prepared: undefined });
});
it.each([{ side: 'sell', quantity: '0.029' }, { side: 'buy', quantity: '0.03' }, { side: 'buy', quoteAmount: '0.12' }, { ...body, slippage: { mode: 'custom', bps: 30 } }])('rejects changed sizing or slippage %j', changed => {
  expect(marketQuoteMatches(quote, changed, DEFAULT_PAIR, undefined)).toBe(false);
});
it('rejects changed assets, fees, and quotes too close to expiry', () => {
  expect(marketQuoteMatches(quote, body, makePair({ ...DEFAULT_PAIR.base, assetId: 'different' }, DEFAULT_PAIR.quote), undefined)).toBe(false);
  expect(marketQuoteMatches(quote, body, DEFAULT_PAIR, { kind: 'market', revision: 2, recipient: 'treasury.near', maxTotalBps: 25, requestedDyaBps: 5 })).toBe(false);
  expect(marketQuoteMatches({ ...quote, expiresAt: new Date(Date.now() + 10000).toISOString() }, body, DEFAULT_PAIR, undefined)).toBe(false);
  expect(marketQuoteMatches({ ...quote, expiresAt: 'invalid' }, body, DEFAULT_PAIR, undefined)).toBe(false);
  expect(marketQuoteMatches(quote, { side: 'buy', quoteAmount: '0.11' }, DEFAULT_PAIR, undefined)).toBe(false);
  expect(marketQuoteMatches({ ...quote, swapType: 'EXACT_INPUT' }, { side: 'buy', quoteAmount: '0.11' }, DEFAULT_PAIR, undefined)).toBe(true);
});
it('rechecks available funds and account identity before signing-payload generation', () => {
  const balances = { accountId, blockHeight: 99, checkedAt: Date.now(), assets: [{ ...DEFAULT_PAIR.quote, amount: '0.5', raw: '500000' }] };
  expect(refreshMarketQuoteBalance(quote, balances, accountId)).toMatchObject({ available: '0.5', balanceBlock: 99 });
  expect(() => refreshMarketQuoteBalance(quote, { ...balances, assets: [{ ...balances.assets[0], raw: '1', amount: '0.000001' }] }, accountId)).toThrow('Insufficient');
  expect(() => refreshMarketQuoteBalance(quote, { ...balances, accountId: 'other' }, accountId)).toThrow();
});
it('does not cache unaffordable quotes and exposes only an opaque reference in the preview', async () => {
  expect(await saveMarketQuote(store, session, accountId, { ...quote, shortfall: '1' })).toBeUndefined();
  const reference = await saveMarketQuote(store, session, accountId, quote);
  const preview = marketPreview.parse({ ...quote, submissionEnabled: false, timeEstimateSeconds: null, quoteReference: reference });
  expect(preview.quoteReference).toBe(reference);
  expect(preview.submissionEnabled).toBe(false);
  expect(preview).not.toHaveProperty('depositAddress');
  expect(preview).not.toHaveProperty('inputRaw');
});
it('encrypts cached financial quote contents with the existing challenge envelope', async () => {
  vi.stubEnv('FINANCIAL_HISTORY_ACTIVE_KEY_ID', 'synthetic');
  vi.stubEnv('FINANCIAL_HISTORY_KEYS', JSON.stringify({ synthetic: 'a'.repeat(64) }));
  await saveMarketQuote(store, session, accountId, quote);
  const id = state.sessions[hash(session)].marketQuoteId!, record = state.challenges[id];
  record.marketTrade = preparedFor(quote);
  const encoded = encodeFinancialRecord('challenges', id, record, 'http://localhost:3101');
  expect(JSON.stringify(encoded)).not.toContain('private-deposit-address');
  expect(JSON.stringify(encoded)).not.toContain('marketQuote');
  expect(JSON.stringify(encoded)).not.toContain('marketTrade');
  expect(JSON.stringify(encoded)).not.toContain(record.marketTrade.payload);
  expect(decodeFinancialRecord('challenges', id, encoded, 'http://localhost:3101')).toEqual(record);
});

function preparedFor(value: ExecutableMarketQuote, signer = accountId): ExecutableMarketTrade {
  const { accountId: ignoredAccount, quoteExpiresAt: ignoredExpiry, swapType: ignoredSwap, ...fields } = value;
  void ignoredAccount; void ignoredExpiry; void ignoredSwap;
  const payload = JSON.stringify({ signer_id: signer, verifying_contract: PRIVATE_VERIFIER, nonce: versionedNonce(PRIVATE_SALT, Date.parse(value.expiresAt)), deadline: value.expiresAt, intents: [{ intent: 'transfer', receiver_id: value.depositAddress, tokens: { [privateAssetId(DEFAULT_PAIR.quote.assetId)]: value.inputRaw } }] });
  return { ...fields, payload, challenge: payloadChallenge(payload).toString('base64url'), correlationId: 'synthetic-correlation' };
}
it('reuses only a correctly bound payload while updating fresh balance metadata', async () => {
  const prepared = preparedFor(quote);
  const reference = await saveMarketQuote(store, session, accountId, quote, prepared);
  const cached = await takeMarketQuote(store, session, accountId, reference, body, DEFAULT_PAIR, undefined);
  const refreshed = { ...cached!.quote, available: '0.5', balanceBlock: 99 };
  expect(reuseMarketSigningPayload(refreshed, cached!.prepared, accountId)).toEqual({ ...prepared, available: '0.5', balanceBlock: 99 });
  expect(state.challenges[hash('active-ceremony')]).toBeDefined();
});
it('rejects expired, mismatched, or malformed warmed payloads', () => {
  const prepared = preparedFor(quote);
  expect(reuseMarketSigningPayload(quote, { ...prepared, expiresAt: new Date(Date.now() + 10000).toISOString() }, accountId)).toBeUndefined();
  expect(reuseMarketSigningPayload(quote, { ...prepared, principal: '0.12' }, accountId)).toBeUndefined();
  expect(reuseMarketSigningPayload(quote, { ...prepared, depositAddress: 'wrong-recipient' }, accountId)).toBeUndefined();
  expect(reuseMarketSigningPayload(quote, preparedFor(quote, 'other-account'), accountId)).toBeUndefined();
  expect(reuseMarketSigningPayload(quote, { ...prepared, payload: 'malformed' }, accountId)).toBeUndefined();
  expect(reuseMarketSigningPayload(quote, { ...prepared, challenge: 'wrong' }, accountId)).toBeUndefined();
});

it('does not reuse a quote or payload after the protocol account identity changes', async () => {
  const prepared = preparedFor(quote);
  const reference = await saveMarketQuote(store, session, accountId, quote, prepared);
  expect(await takeMarketQuote(store, session, accountId, reference, body, DEFAULT_PAIR, undefined, Date.now(), 'changed-protocol-account')).toBeUndefined();
  expect(reuseMarketSigningPayload({ ...quote, accountId: 'changed-protocol-account' }, prepared, accountId)).toBeUndefined();
});
