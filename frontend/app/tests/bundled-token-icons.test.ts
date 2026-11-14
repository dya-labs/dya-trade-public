import { expect, test } from "vitest";
import { coinMarketCapIdentities } from "../../../packages/wallet-contracts/src/market-data/coinmarketcap";
import { bundledTokenIcon } from "../../../packages/wallet-ui/src/lib/bundled-token-icons";

test("bundles valid PNGs for every verified identity", () => {
  for (const identity of Object.keys(coinMarketCapIdentities)) {
    const uri = bundledTokenIcon(identity);
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(uri.split(",")[1], "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }
});

test("unknown identities and ticker symbols do not select a verified icon", () => {
  expect(bundledTokenIcon("unknown-token")).toBeUndefined();
  expect(bundledTokenIcon("USDC")).toBeUndefined();
});
