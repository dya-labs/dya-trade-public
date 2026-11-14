// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { QuoteTimings } from '../../../backend/id/src/near/services/quote-timings';
import { relayWalletResponse } from '../../../backend/id/src/near/http/storage-response';

afterEach(() => vi.restoreAllMocks());
it('measures nested provider time separately and relays the timings without wallet cookies', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const timing = new QuoteTimings();
  await timing.measure('preview', () => timing.measure('oneclick', async () => { now = 1500; }));
  now = 1600;
  expect(timing.snapshot()).toEqual({ oneclick: 1500, preview: 1500, total: 1600 });
  const source = new Response('{}', { headers: { 'Server-Timing': timing.header(), 'Set-Cookie': 'private-wallet-session' } });
  const response = relayWalletResponse({}, source);
  expect(response.headers.get('Server-Timing')).toBe('quote_oneclick;dur=1500, quote_preview;dur=1500, quote_total;dur=1600');
  expect(response.headers.has('Set-Cookie')).toBe(false);
});
it('records a failed stage without logging the thrown payload', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const timing = new QuoteTimings();
  await expect(timing.measure('balances', async () => { throw new Error('sensitive-provider-payload'); })).rejects.toThrow();
  timing.log('error');
  expect(log).toHaveBeenCalledWith('trading.quote.backend', expect.objectContaining({ outcome: 'error', balances: expect.any(Number), total: expect.any(Number) }));
  expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive-provider-payload');
});
