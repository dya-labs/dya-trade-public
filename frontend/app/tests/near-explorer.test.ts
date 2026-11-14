import { describe, expect, it } from "vitest";
import { nearTransactionUrl, bscTransactionUrl, bscAddressUrl } from "@/lib/near/domain/explorer";

it("links only plausible NEAR transaction hashes", () => {
  expect(nearTransactionUrl("A".repeat(44))).toBe(`https://nearblocks.io/txns/${"A".repeat(44)}`);
  expect(nearTransactionUrl("provider-order-1")).toBeNull();
  expect(nearTransactionUrl("0x" + "a".repeat(64))).toBeNull();
  expect(nearTransactionUrl("../bad")).toBeNull();
});

describe("BSC explorer links", () => {
  it("links only complete EVM transaction hashes", () => {
    expect(bscTransactionUrl("0x" + "a".repeat(64))).toBe("https://bscscan.com/tx/0x" + "a".repeat(64));
    expect(bscTransactionUrl("0x" + "a".repeat(40))).toBeNull();
    expect(bscTransactionUrl("javascript:alert(1)")).toBeNull();
    expect(bscAddressUrl("0x" + "a".repeat(40))).toBe("https://bscscan.com/address/0x" + "a".repeat(40));
    expect(bscAddressUrl("0x" + "a".repeat(64))).toBeNull();
  });
});

it('routes transaction hashes only to recognized networks and validates their format', async () => {
  const { transactionExplorerUrl } = await import('@/lib/near/domain/explorer');
  const evm = '0x' + 'a'.repeat(64);
  expect(transactionExplorerUrl('Ethereum', evm)).toBe(`https://etherscan.io/tx/${evm}`);
  expect(transactionExplorerUrl('Base', evm)).toBe(`https://basescan.org/tx/${evm}`);
  expect(transactionExplorerUrl('NEAR', '7'.repeat(44))).toBe(`https://nearblocks.io/txns/${'7'.repeat(44)}`);
  expect(transactionExplorerUrl('NEAR', evm)).toBeNull();
  expect(transactionExplorerUrl('Ethereum', 'internal-transfer-id')).toBeNull();
  expect(transactionExplorerUrl('unknown-chain', evm)).toBeNull();
  expect(transactionExplorerUrl('Ethereum', evm + '?redirect=evil')).toBeNull();
});
it('links validated recipient addresses to their own network explorer', async () => {
  const { addressExplorerUrl } = await import('@/lib/near/domain/explorer');
  const address = '0x' + '1'.repeat(40);
  expect(addressExplorerUrl('Ethereum', address)).toBe(`https://etherscan.io/address/${address}`);
  expect(addressExplorerUrl('Base', address)).toBe(`https://basescan.org/address/${address}`);
  expect(addressExplorerUrl('NEAR', 'alice.near')).toBe('https://nearblocks.io/address/alice.near');
  expect(addressExplorerUrl('Ethereum', address + '/evil')).toBeNull();
  expect(addressExplorerUrl('unknown-chain', address)).toBeNull();
});
