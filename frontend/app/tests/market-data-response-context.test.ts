import { expect, it, vi } from "vitest";
import { DataApi, DataApiError } from "@/lib/market-data/api";
const market = "binance:NEARUSDC";
const page = () => ({ market, interval: "1h", revision: "7", page: 100, prev: 99, final: true, bars: [[360000000, "1", "2", "0.5", "1.5", "10", "15", 4, "5", "7"]] });
const client = (body: unknown) => new DataApi("https://data.test", vi.fn(async () => Response.json(body)));
const unavailable = { status: 502, message: "Market data is unavailable. Try again shortly." };
it.each([
  ["market", "binance:BTCUSDT"], ["interval", "4h"], ["page", 99], ["revision", "8"],
])("rejects a historical response with the wrong %s", async (key, value) => {
  await expect(client({ ...page(), [key]: value }).page(market, "1h", 100, "7")).rejects.toMatchObject(unavailable);
});
it.each([["market", "binance:BTCUSDT"], ["interval", "4h"]])("rejects a latest response with the wrong %s", async (key, value) => {
  await expect(client({ ...page(), [key]: value }).latest(market, "1h")).rejects.toMatchObject(unavailable);
});
it("rejects public trades labeled for another market", async () => {
  await expect(client({ market: "intents:BTC_USD", trades: [] }).intentsTrades("intents:NEAR_USD")).rejects.toMatchObject(unavailable);
});
it("rejects a non-decreasing previous-page link rather than allowing an endless history walk", async () => {
  await expect(client({ ...page(), prev: 100 }).page(market, "1h", 100, "7")).rejects.toMatchObject(unavailable);
});
it("sanitizes malformed successful responses into a recoverable market-data error", async () => {
  const request = client({ ...page(), bars: "synthetic invalid payload" }).latest(market, "1h");
  await expect(request).rejects.toBeInstanceOf(DataApiError);
  await expect(request).rejects.toMatchObject(unavailable);
});
it("retains exact valid candle values and encodes the requested context", async () => {
  const body = page();body.bars[0][4] = "0.000000000000000001";
  const fetcher = vi.fn<(input: string) => Promise<Response>>(async () => Response.json(body));
  const api = new DataApi("https://data.test", fetcher);
  expect(await api.page(market, "1h", 100, "7")).toEqual(body);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ market, interval: "1h", page: "100", rev: "7" });
});

it.each([-8_640_000_000_000_001, 8_640_000_000_000_001])("rejects public trade time outside the JavaScript date range (%s)", async time => {
  await expect(client({ market: "intents:NEAR_USD", trades: [{ time, price: "5", quantity: "1", side: "buy", txHash: "synthetic" }] }).intentsTrades("intents:NEAR_USD")).rejects.toMatchObject(unavailable);
});
it.each([-8_640_000_000_000_000, 8_640_000_000_000_000])("preserves representable public trade date boundary (%s)", async time => {
  const trades = [{ time, price: "5", quantity: "1", side: "buy", txHash: "synthetic" }];
  expect(await client({ market: "intents:NEAR_USD", trades }).intentsTrades("intents:NEAR_USD")).toEqual(trades);
});
