import { PRIVATE_VERIFIER, PRIVATE_SALT, privateAssetId } from "../../../packages/wallet-contracts/src/domain/confidential";
import { payloadChallenge, versionedNonce } from "../../../backend/id/src/near/auth/intents";
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runMarketTrades } from '../../../backend/id/src/near/services/market-trades-workflow';
import { collectExecutableMarketQuote, prepareExecutableMarketTrade, prepareMarketSigningPayload, type ExecutableMarketQuote, type ExecutableMarketTrade } from '../../../backend/id/src/near/services/market-execution';
import { emptyState, hash, type SnapshotReader, type State, type StateStore } from '../../../backend/id/src/near/repositories/store';
import { DEFAULT_PAIR } from '@/lib/near/domain/catalog';
import { approvedTestTokens } from './fixtures/token-policy';
import { getDeploymentConfig } from '../../../backend/id/src/deployment/config';
vi.mock('../../../backend/id/src/near/services/market-execution', async original => ({ ...await original<typeof import('../../../backend/id/src/near/services/market-execution')>(), collectExecutableMarketQuote: vi.fn(), prepareExecutableMarketTrade: vi.fn(), prepareMarketSigningPayload: vi.fn() }));
vi.mock('../../../backend/id/src/near/providers/catalog', async original => ({ ...await original<typeof import('../../../backend/id/src/near/providers/catalog')>(), readCatalog: async () => [DEFAULT_PAIR.base, DEFAULT_PAIR.quote] }));
vi.mock('../../../backend/id/src/near/auth/intents', async original => ({ ...await original<typeof import('../../../backend/id/src/near/auth/intents')>(), accountIdentity: () => ({ accountId: '0x' + 'a'.repeat(40) }) }));
const session = 'session', accountId = 'alice', identity = '0x' + 'a'.repeat(40);
const body = { side: 'buy', quantity: '0.029', orderType: 'market' };
let state: State, store: StateStore, quote: ExecutableMarketQuote, review: ExecutableMarketTrade;
let balanceReader: Parameters<typeof runMarketTrades>[0]['balanceReader'];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3101');
  state = emptyState();
  state.accounts[accountId] = { id: accountId, kind: 'passkey', credentialId: 'credential', publicKey: 'synthetic', counter: 0 };
  state.sessions[hash(session)] = { accountId, expires: Date.now() + 600000, ceremony: 'existing' };
  state.challenges[hash('existing')] = { purpose: 'market-trade', value: 'existing', accountId, expires: Date.now() + 600000 };
  state.tokens = Object.fromEntries(approvedTestTokens([DEFAULT_PAIR.base, DEFAULT_PAIR.quote]).map(t => [t.id, { ...t, trading: true, coingeckoIdOverride: 'synthetic' }]));
  store = { read: fn => fn(state), transaction: fn => fn(state) };
  quote = { accountId: identity, orderType: 'market', side: 'buy', submissionEnabled: true, confidentiality: 'advanced', pair: DEFAULT_PAIR,
    quantity: '0.029', inputSymbol: DEFAULT_PAIR.quote.symbol, outputSymbol: DEFAULT_PAIR.base.symbol, inputRaw: '110000', outputRaw: '29000000000000000000000', principal: '0.11', estimatedOutput: '0.029', minimumOutput: '0.028', available: '1', shortfall: '0', balanceBlock: 1, slippageBps: 30, slippagePolicy: { mode: 'default' }, expiresAt: new Date(Date.now() + 120000).toISOString(), quoteExpiresAt: new Date(Date.now() + 120000).toISOString(), swapType: 'EXACT_OUTPUT', depositAddress: 'private-address', depositMemo: null };
  const { accountId: ignoredAccount, quoteExpiresAt: ignored, swapType: ignoredSwap, ...fields } = quote; void ignoredAccount; void ignored; void ignoredSwap;
  const payload = JSON.stringify({ signer_id: identity, verifying_contract: PRIVATE_VERIFIER, nonce: versionedNonce(PRIVATE_SALT, Date.parse(quote.expiresAt)), deadline: quote.expiresAt, intents: [{ intent: "transfer", receiver_id: quote.depositAddress, tokens: { [privateAssetId(DEFAULT_PAIR.quote.assetId)]: quote.inputRaw } }] });
  review = { ...fields, payload, challenge: payloadChallenge(payload).toString('base64url'), correlationId: 'synthetic' };
  vi.mocked(collectExecutableMarketQuote).mockReset().mockResolvedValue(quote);
  vi.mocked(prepareMarketSigningPayload).mockReset().mockResolvedValue(review);
  vi.mocked(prepareExecutableMarketTrade).mockReset().mockResolvedValue(review);
  balanceReader = vi.fn(async () => ({ accountId: identity, blockHeight: 99, checkedAt: Date.now(), assets: [{ ...DEFAULT_PAIR.quote, amount: '0.5', raw: '500000' }] }));
});
afterEach(() => vi.unstubAllEnvs());
async function call(route: string, input: Record<string, unknown>, held?: SnapshotReader) {
  return runMarketTrades({ route, body: input, store, deployment: getDeploymentConfig(), url: new URL('http://localhost:3101/api/near/' + route), session, ceremony: 'existing', balanceReader, account: state.accounts[accountId], simulator: vi.fn(), held });
}
async function preview() {
  const result = await call('live/preview', { ...body, reusable: true });
  const data = result!.body as { quoteReference: string };
  return { result: result!, reference: data.quoteReference };
}
const stored = () => state.challenges[state.sessions[hash(session)].marketQuoteId!];
it('warms a signing payload without preparing approval, then skips both provider requests on Review', async () => {
  const { result, reference } = await preview();
  expect(reference).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(result.body).toMatchObject({ submissionEnabled: false, principal: '0.11' });
  expect(result.body).not.toHaveProperty('depositAddress');
  expect(result.body).not.toHaveProperty('payload');
  expect(result.cookies).toHaveLength(0);
  expect(state.sessions[hash(session)].ceremony).toBe('existing');
  expect(prepareMarketSigningPayload).toHaveBeenCalledOnce();
  expect(collectExecutableMarketQuote).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(String), undefined, undefined, undefined, DEFAULT_PAIR, true, undefined, expect.anything(), { allowShortfall: true, quoteWaitingTimeMs: 1500 });
  const ready = await call('live/market/prepare', { ...body, quoteReference: reference });
  expect(collectExecutableMarketQuote).toHaveBeenCalledOnce();
  expect(prepareExecutableMarketTrade).not.toHaveBeenCalled();
  expect(balanceReader).toHaveBeenCalledOnce();
  expect(prepareMarketSigningPayload).toHaveBeenCalledOnce();
  expect(ready!.body).toHaveProperty('review.available', '0.5');
  expect(ready!.body).toHaveProperty('review.balanceBlock', 99);
  expect(ready!.body).toHaveProperty('options');
  expect(ready!.cookies).toHaveLength(1);
});
it('holds the quick and the full-window quote of an input under the reference the ticket names', async () => {
  const named = 'n'.repeat(43), full = { ...quote, minimumOutput: '0.0285' };
  vi.mocked(collectExecutableMarketQuote).mockResolvedValueOnce(quote).mockResolvedValueOnce(full);
  for (const fast of [true, false]) expect((await call('live/preview', { ...body, reusable: true, quoteReference: named, ...(fast ? { fast } : {}) }))!.body).toMatchObject({ quoteReference: named });
  expect(vi.mocked(collectExecutableMarketQuote).mock.calls.map(args => args[10]?.quoteWaitingTimeMs)).toEqual([300, 1500]);
  expect(stored().marketQuote).toEqual(full);
  await call('live/market/prepare', { ...body, quoteReference: named });
  expect(collectExecutableMarketQuote).toHaveBeenCalledTimes(2);
  expect(prepareExecutableMarketTrade).not.toHaveBeenCalled();
});
it.each(['expired', 'changed-input', 'unknown-reference'])('recollects when the cached quote is %s', async condition => {
  const { reference } = await preview();
  vi.mocked(prepareMarketSigningPayload).mockClear();
  if (condition === 'expired') stored().expires = Date.now() - 1;
  await call('live/market/prepare', { ...body, ...(condition === 'changed-input' ? { quantity: '0.03' } : {}), quoteReference: condition === 'unknown-reference' ? 'x'.repeat(43) : reference });
  expect(prepareExecutableMarketTrade).toHaveBeenCalledOnce();
  expect(prepareMarketSigningPayload).not.toHaveBeenCalled();
});
it('fails closed when a fresh balance read fails after a cache hit', async () => {
  const { reference } = await preview();
  vi.mocked(prepareMarketSigningPayload).mockClear();
  vi.mocked(balanceReader).mockRejectedValueOnce(new Error('Unavailable'));
  await expect(call('live/market/prepare', { ...body, quoteReference: reference })).rejects.toThrow('Unavailable');
  expect(prepareMarketSigningPayload).not.toHaveBeenCalled();
  expect(prepareExecutableMarketTrade).not.toHaveBeenCalled();
});
it('does not replace an active signing ceremony when a later background quote arrives', async () => {
  await preview();
  state.sessions[hash(session)].ceremony = 'signing-in-progress';
  state.challenges[hash('signing-in-progress')] = { purpose: 'market-trade', value: 'signing', accountId, expires: Date.now() + 600000 };
  await preview();
  expect(state.sessions[hash(session)].ceremony).toBe('signing-in-progress');
  expect(state.challenges[hash('signing-in-progress')]).toBeDefined();
});
it.each(['live/preview', 'live/market/prepare'])('refuses %s for a pair that only the snapshot the service holds still approves', async route => {
  const before = structuredClone(state), held: SnapshotReader = { read: fn => fn(before) };
  state.tokens![DEFAULT_PAIR.base.assetId].trading = false;
  await expect(call(route, route === 'live/preview' ? { ...body, reusable: true } : body, held)).rejects.toThrow('This token');
  expect(state.sessions[hash(session)].marketQuoteId).toBeUndefined();
  expect(Object.keys(state.challenges)).toEqual([hash('existing')]);
});

it("regenerates an expired signing payload while retaining the still-valid executable quote", async () => {
  const { reference } = await preview();
  stored().marketTrade = { ...review, expiresAt: new Date(Date.now() - 1).toISOString() };
  vi.mocked(prepareMarketSigningPayload).mockClear();
  await call('live/market/prepare', { ...body, quoteReference: reference });
  expect(collectExecutableMarketQuote).toHaveBeenCalledOnce();
  expect(prepareExecutableMarketTrade).not.toHaveBeenCalled();
  expect(prepareMarketSigningPayload).toHaveBeenCalledOnce();
});
it("retains a usable quote if optional background payload warming fails", async () => {
  vi.mocked(prepareMarketSigningPayload).mockRejectedValueOnce(new Error('Synthetic provider failure'));
  const { reference } = await preview();
  expect(stored().marketTrade).toBeUndefined();
  vi.mocked(prepareMarketSigningPayload).mockClear();
  await call('live/market/prepare', { ...body, quoteReference: reference });
  expect(collectExecutableMarketQuote).toHaveBeenCalledOnce();
  expect(prepareMarketSigningPayload).toHaveBeenCalledOnce();
});
it("does not warm signing payloads for unaffordable quotes", async () => {
  vi.mocked(collectExecutableMarketQuote).mockResolvedValueOnce({ ...quote, shortfall: '1' });
  const { reference } = await preview();
  expect(reference).toBeUndefined();
  expect(prepareMarketSigningPayload).not.toHaveBeenCalled();
});

it('recollects rather than reusing a quote for a changed protocol identity', async () => {
  const { reference } = await preview();
  stored().marketQuote!.accountId = 'changed-protocol-account';
  vi.mocked(prepareMarketSigningPayload).mockClear();
  await call('live/market/prepare', { ...body, quoteReference: reference });
  expect(prepareExecutableMarketTrade).toHaveBeenCalledOnce();
  expect(prepareMarketSigningPayload).not.toHaveBeenCalled();
});

it('starts a fresh balance request while the cached quote claim is still pending', async () => {
  const { reference } = await preview();
  const transaction = store.transaction;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let claiming = false;
  store.transaction = async fn => {
    claiming = true;
    await gate;
    return transaction(fn);
  };
  const pending = call('live/market/prepare', { ...body, quoteReference: reference });
  await vi.waitFor(() => {
    expect(claiming).toBe(true);
    expect(balanceReader).toHaveBeenCalledOnce();
  });
  release();
  expect(await pending).toHaveProperty('body.options');
  expect(balanceReader).toHaveBeenCalledOnce();
});
