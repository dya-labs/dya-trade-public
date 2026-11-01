import type { ClickHouse } from "../../clickhouse";
import { loadNearState, type NearSource, type NearState } from "../../near/indexer";
import { isSwapLog, RHEA_CONTRACTS, swapsFromLogs, type Swap } from "./swaps";

/** Rhea's swap logs for the shared NEAR indexer: classic `Swapped` logs and DCL swap events. */
export const rheaSource: NearSource<Swap> = {
  id: "rhea",
  accounts: new Set(Object.keys(RHEA_CONTRACTS)),
  matches: isSwapLog,
  rowsTable: "rhea_swaps",
  stateTable: "rhea_state",
  parse: swapsFromLogs,
  row: swap => ({
    token_in: swap.tokenIn, token_out: swap.tokenOut, block_time: String(swap.time), receipt_id: swap.receiptId, log_index: swap.logIndex,
    block_height: swap.height, tx_hash: swap.txHash, contract: swap.contract, pool_id: swap.poolId,
    amount_in: swap.amountIn.toString(), amount_out: swap.amountOut.toString(),
  }),
};

export const loadRheaState = (clickhouse: ClickHouse): Promise<NearState> => loadNearState(clickhouse, rheaSource.stateTable);
