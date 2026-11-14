import { DEFAULT_PAIR, quantityRaw } from '@/lib/near/domain/catalog';

const base = { ...DEFAULT_PAIR.base, coingeckoId: 'near' };
const variant = { ...base, assetId: 'storybook:near-on-base', blockchain: 'base' };
const unfunded = { ...base, assetId: 'storybook:near-on-ethereum', blockchain: 'eth' };
const unrelated = { ...base, assetId: 'storybook:unrelated-near', blockchain: 'arb', coingeckoId: 'unrelated' };
export const fundedNetworkCatalog = [base, variant, unfunded, unrelated, DEFAULT_PAIR.quote];
export const fundedNetworkBalances = [base, variant, unrelated, DEFAULT_PAIR.quote].map((asset, index) => {
  const amount = ['100', '7', '9', '1250.50'][index];
  return { assetId: asset.assetId, symbol: asset.symbol, decimals: asset.decimals, amount, raw: quantityRaw(amount, asset.decimals) };
});
export let fundedNetworkFixture = false;
export function setFundedNetworkFixture(value: boolean) { fundedNetworkFixture = value; }
