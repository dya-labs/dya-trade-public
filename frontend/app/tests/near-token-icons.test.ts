// @vitest-environment node
import { expect, it } from "vitest";
import { readDataApiIcons } from "../../../backend/id/src/near/providers/token-icons";
const metrics = { price: 2, change24h: null, volume24h: null, marketCap: null };
it("serves icons by 1Click asset id from the data API snapshot and omits assets without an image", async () => {
  const urls: string[] = [];
  const icons = await readDataApiIcons(async input => {
    urls.push(String(input));
    return Response.json({ updatedAt: 1, assets: {
      "nep141:wrap.near": { ...metrics, image: "https://coin-images.coingecko.com/near.png" },
      "no-image": { ...metrics, image: null },
    }, coins: {} });
  });
  expect(icons).toEqual({ "nep141:wrap.near": "https://coin-images.coingecko.com/near.png" });
  expect(urls).toEqual(["http://127.0.0.1:8080/v1/token-markets"]);
});
it("throws on outages and foreign image hosts so the cache keeps its last good icons", async () => {
  await expect(readDataApiIcons(async () => new Response(null, { status: 503 }))).rejects.toThrow("503");
  await expect(readDataApiIcons(async () => Response.json({ updatedAt: 1, assets: { a: { ...metrics, image: "https://example.com/a.png" } } }))).rejects.toThrow();
});
