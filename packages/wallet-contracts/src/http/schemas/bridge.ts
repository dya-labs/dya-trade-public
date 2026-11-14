import { z } from "zod";
import { catalogAsset } from "../../domain/catalog";
import { rawAmount, text } from "./common";

export const bridgeRoute = z.object({ asset: catalogAsset, chain: text, minimum: rawAmount });
export const bridgeRoutes = z.object({ routes: z.array(bridgeRoute) });
export const bridgeAddress = z.object({ asset: catalogAsset, chain: text, minimum: rawAmount, address: text, memo: text.nullable() });
export const bridgeDeposit = z.object({
  assetId: text, chain: text, amount: rawAmount, decimals: z.number().int().min(0).max(38),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]), txHash: z.string(), address: text,
});
export const bridgeDeposits = z.object({ deposits: z.array(bridgeDeposit) });
export type BridgeAddress = z.infer<typeof bridgeAddress>;
