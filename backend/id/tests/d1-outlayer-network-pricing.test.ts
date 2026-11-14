import { expect, test, vi } from "vitest";
import { readSetupNetworkPricing } from "../src/near/outlayer/network-pricing";
function fixture(gasPrice = "100000000", protocolVersion = 88) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ result: { header: { hash: "final-block", height: 42, gas_price: gasPrice, timestamp_nanosec: "1800000000000000000" } } })).mockResolvedValueOnce(Response.json({ result: { protocol_version: protocolVersion, runtime_config: { min_gas_purchase_price: "1000000000", account_creation_charge: "7000000000000000000000", storage_amount_per_byte: "10000000000000000000" } } }));
}
test("reserves at the upfront gas purchase price and binds config to the same finalized block", async () => {
  const fetcher = fixture();
  expect(await readSetupNetworkPricing(fetcher)).toMatchObject({ gasBurnPriceYoctoNear: "100000000", gasPurchasePriceYoctoNear: "1000000000", blockHash: "final-block" });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ method: "EXPERIMENTAL_protocol_config", params: { block_id: "final-block" } });
});
test("uses actual gas price when higher than the purchase floor, preserving integer precision", async () => {
  expect((await readSetupNetworkPricing(fixture("9007199254740993"))).gasPurchasePriceYoctoNear).toBe("9007199254740993");
});
test("fails closed after a protocol upgrade instead of trusting the previous fee model", async () => {
  await expect(readSetupNetworkPricing(fixture(undefined, 89))).rejects.toThrow("protocol changed");
});
