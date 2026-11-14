import { AppError, ErrorCode, RemoteRequestError } from "@/lib/near/domain/errors";

export function ticketErrorCode(error: unknown): ErrorCode | undefined {
  return error instanceof RemoteRequestError ? error.remoteCode : error instanceof AppError ? error.code : undefined;
}

export function ticketErrorField(code?: ErrorCode): "size" | "price" | undefined {
  switch (code) {
    case ErrorCode.PositiveLimitValueRequired: return "price";
    case ErrorCode.InvalidAssetQuantity:
    case ErrorCode.QuoteExceedsEnteredBudget:
    case ErrorCode.QuoteExceedsPercentageBudget:
    case ErrorCode.LimitOrderAmountTooSmall:
    case ErrorCode.InsufficientExecutableBalance:
    case ErrorCode.PositiveUsdcAmountRequired:
    case ErrorCode.PositiveAssetAmountRequired:
    case ErrorCode.InsufficientIntentsBalance:
    case ErrorCode.InsufficientIntentsBalanceForThisLimitOrder:
    case ErrorCode.ProviderFeesMakeThisOrderExceedTheAvailableBalance:
    case ErrorCode.EnterAPositiveQuantityWithUpToSixDecimalPlaces:
    case ErrorCode.InsufficientWNEARBalanceForThisMarketSell:
    case ErrorCode.EnterAPositiveAmountWithinTheTokenPrecision:
    case ErrorCode.InsufficientFundingBalance: return "size";
    default: return undefined;
  }
}
