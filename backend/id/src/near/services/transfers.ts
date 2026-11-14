import { ACTIVE_PAIR } from "../../../../../packages/wallet-contracts/src/domain/assets";
import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";

import { D } from "../../../../../packages/wallet-contracts/src/domain/decimal";
import { VERIFIER } from "../auth/intents";

export type TransferAsset = "NEAR" | "USDC";
export function nearAccount(value: unknown): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 64 ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value) || /^0x/.test(value))
    throw new AppError(ErrorCode.EnterANEARAccountIDNotAnIntentsOrEVMAddress);
  if (value === VERIFIER) throw new AppError(ErrorCode.ChooseYourExternalNEARWalletAccount);
  return value;
}
function assetAmount(asset: unknown, amount: unknown) {
  if (asset !== "NEAR" && asset !== "USDC") throw new AppError(ErrorCode.ChooseNEAROrUSDC);
  const metadata = (asset === "NEAR" ? ACTIVE_PAIR.base : ACTIVE_PAIR.quote);
  if (typeof amount !== "string" || !/^(0|[1-9][0-9]{0,11})(\.[0-9]+)?$/.test(amount) ||
      (amount.split(".")[1]?.length ?? 0) > metadata.decimals || new D(amount).lte(0))
    throw new AppError(ErrorCode.EnterAPositiveAmountWithinTheTokenPrecision);
  const raw = new D(amount).mul(new D(10).pow(metadata.decimals)).toFixed(0);
  if (BigInt(raw) > (BigInt(1) << BigInt(128)) - BigInt(1)) throw new AppError(ErrorCode.AmountTooLarge);
  return { asset: asset as TransferAsset, amount: new D(amount).toFixed(), raw, metadata };
}
// Route preparation only. A verified provider quote must supply deposit instructions.
// Never construct a public verifier transaction as a fallback.
export async function prepareTransfer(body: Record<string, unknown>, accountId: string) {
  if (!/^0x[0-9a-f]{40}$/.test(accountId)) throw new AppError(ErrorCode.InvalidIntentsIdentity);
  const { asset, amount, raw, metadata } = assetAmount(body.asset, body.amount);
  const wallet = nearAccount(body.wallet);
  if (body.direction !== "deposit" && body.direction !== "withdraw") throw new AppError(ErrorCode.ChooseDepositOrWithdrawal);
  const deposit = body.direction === "deposit";
  return {
    direction: body.direction, asset, amount, wallet, accountId,
    submissionEnabled: false as const, status: "configuration_required" as const,
    transaction: null, intent: null, depositAddress: null,
    request: {
      dry: true, swapType: "EXACT_INPUT", originAsset: metadata.assetId,
      destinationAsset: metadata.assetId, amount: raw, slippageTolerance: 0,
      depositType: deposit ? "ORIGIN_CHAIN" : "CONFIDENTIAL_INTENTS",
      recipientType: deposit ? "CONFIDENTIAL_INTENTS" : "DESTINATION_CHAIN",
      refundType: deposit ? "ORIGIN_CHAIN" : "CONFIDENTIAL_INTENTS",
      recipient: deposit ? accountId : wallet, refundTo: deposit ? wallet : accountId,
      confidentiality: "basic", deadline: new Date(Date.now() + 300000).toISOString(),
    },
  };
}
export type TransferReview = Awaited<ReturnType<typeof prepareTransfer>>;
