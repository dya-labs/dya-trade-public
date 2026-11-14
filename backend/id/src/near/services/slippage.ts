import { DEFAULT_SLIPPAGE_BPS, slippageSettings } from "../../../../../packages/wallet-contracts/src/http/schemas/trading";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";

export { DEFAULT_SLIPPAGE_BPS };
export type SlippagePolicy = { mode: "default" } | { mode: "custom" };

/** Fixed default or explicit custom maximum, validated before requesting a quote. */
export function selectMarketSlippage(setting: unknown): { bps: number; policy: SlippagePolicy } {
  const parsed = slippageSettings.safeParse(setting === undefined ? { mode: "default" } : setting);
  if (!parsed.success) throw new AppError(ErrorCode.InvalidRequest);
  return parsed.data.mode === "custom"
    ? { bps: parsed.data.bps, policy: { mode: "custom" } }
    : { bps: DEFAULT_SLIPPAGE_BPS, policy: { mode: "default" } };
}
