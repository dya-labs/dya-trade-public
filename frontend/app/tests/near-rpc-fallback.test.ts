import { afterEach, expect, it, vi } from "vitest";
import { simulateSignedIntents, type SignedWebAuthn } from "../../../backend/id/src/near/auth/intents";

const FASTNEAR = "https://rpc.mainnet.fastnear.com", NEAR_ORG = "https://rpc.mainnet.near.org";
const salt = () => Response.json({ result: { block_height: 123, result: [...Buffer.from(JSON.stringify({ intents_executed: [], state: { current_salt: "252812b3" } }))] } });
const authorization = (init: RequestInit | undefined) => new Headers(init?.headers).get("authorization");
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("sends unsigned calls to FastNEAR, with the key only as a header when one is set", async () => {
  for (const [key, header] of [["fastnear-test-key", "Bearer fastnear-test-key"], ["", null]] as const) {
    vi.stubEnv("FASTNEAR_API_KEY", key);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(salt());
    expect((await simulateSignedIntents([], fetcher)).blockHeight).toBe(123);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(FASTNEAR);
    expect(authorization(fetcher.mock.calls[0][1])).toBe(header);
    expect(JSON.parse(Buffer.from(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).params.args_base64, "base64").toString())).toEqual({ signed: [] });
  }
});

it("falls back to near.org without the key when FastNEAR answers an error or can't be reached", async () => {
  vi.stubEnv("FASTNEAR_API_KEY", "fastnear-test-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const failure of [() => Promise.resolve(new Response(null, { status: 429 })), () => Promise.resolve(new Response(null, { status: 502 })), () => Promise.reject(new TypeError("fetch failed"))]) {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(failure).mockResolvedValueOnce(salt());
    expect((await simulateSignedIntents([], fetcher)).blockHeight).toBe(123);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([FASTNEAR, NEAR_ORG]);
    expect(authorization(fetcher.mock.calls[1][1])).toBeNull();
  }
});

it("sends signed payloads only to near.org, never with the key, even when rate limited", async () => {
  vi.stubEnv("FASTNEAR_API_KEY", "fastnear-test-key");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
  await expect(simulateSignedIntents([{} as SignedWebAuthn], fetcher)).rejects.toThrow("429");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe(NEAR_ORG);
  expect(authorization(fetcher.mock.calls[0][1])).toBeNull();
});
