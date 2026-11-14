import { describe, expect, it } from "vitest";
import { groupWalletAssets } from "@dya/wallet-ui/components/wallet-assets";
const holdings = [
  {assetId:"a",symbol:"USDC",decimals:6,raw:"100000",amount:"0.1"},
  {assetId:"b",symbol:"USDC",decimals:18,raw:"200000000000000000",amount:"0.2"},
];
const catalog = holdings.map((item, index) => ({...item, blockchain:index ? "base" : "near",coingeckoId:"usd-coin"}));
describe("wallet asset grouping", () => {
  it("combines catalog identities using decimal amounts across differing precisions", () => {
    const grouped = groupWalletAssets(holdings, catalog);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].amount).toBe("0.3");
    expect(grouped[0].holdings).toHaveLength(2);
  });
  it("keeps matching tickers separate without matching catalog identity", () => {
    expect(groupWalletAssets(holdings, [catalog[0], {...catalog[1],coingeckoId:"other-token"}])).toHaveLength(2);
    expect(groupWalletAssets(holdings, [])).toHaveLength(2);
  });
});
