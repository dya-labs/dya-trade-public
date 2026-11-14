import { z } from "zod";
import { publicRpc } from "../auth/intents";
const amount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);

/** Finalized protocol prices, not a complete setup quote. The execution plan must
 * still bound gas for initialization, controller funding, policy write and unwrap. */
export async function readSetupNetworkPricing(fetcher: typeof fetch = fetch) {
  async function rpc(method: string, params: unknown) {
    const response = await publicRpc(JSON.stringify({ jsonrpc: "2.0", id: "outlayer-setup-prices", method, params }), fetcher);
    if (!response.ok) throw new Error("Mainnet setup pricing is unavailable.");
    const body = z.object({ result: z.unknown().optional(), error: z.unknown().optional() }).parse(await response.json());
    if (body.error || !body.result) throw new Error("Mainnet setup pricing was not confirmed.");
    return body.result;
  }
  const block = z.object({ header: z.object({ hash: z.string().min(1), height: z.number().int().nonnegative(), gas_price: amount, timestamp_nanosec: amount }) }).parse(await rpc("block", { finality: "final" }));
  const config = z.object({ protocol_version: z.number().int(), runtime_config: z.object({ min_gas_purchase_price: amount, account_creation_charge: amount, storage_amount_per_byte: amount }) }).parse(await rpc("EXPERIMENTAL_protocol_config", { block_id: block.header.hash }));
  // This version's price model was reviewed against nearcore 2.14.0. A new
  // protocol needs review before these values become a customer payment bound.
  if (config.protocol_version !== 88) throw new Error("Mainnet protocol changed. Setup fee calculation needs review.");
  const gasPrice = BigInt(block.header.gas_price);
  const purchaseFloor = BigInt(config.runtime_config.min_gas_purchase_price);
  return { network: "mainnet" as const, blockHash: block.header.hash, blockHeight: block.header.height, blockTimestampNanosec: block.header.timestamp_nanosec, protocolVersion: config.protocol_version,
    gasBurnPriceYoctoNear: gasPrice.toString(), gasPurchasePriceYoctoNear: (gasPrice > purchaseFloor ? gasPrice : purchaseFloor).toString(),
    accountCreationChargeYoctoNear: config.runtime_config.account_creation_charge, storagePricePerByteYoctoNear: config.runtime_config.storage_amount_per_byte };
}
