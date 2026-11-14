import { expect, it } from "vitest";
import { coinMarketCapIdentities as ids } from "../../../packages/wallet-contracts/src/market-data/coinmarketcap";
it("keeps ambiguous tokens distinct and covers audited project aliases", () => {
  expect(ids['black-dragon']).toBe(29627);
  expect(ids['dogwifcoin']).toBe(28752);
  expect(ids['optimism']).toBe(11840);
  expect(ids['sui']).toBe(20947);
  expect(ids['jambo-2']).toBeUndefined();
  expect(ids['nearkat-2']).toBeUndefined();
  expect(ids['nearkat']).toBe(34150);
});
