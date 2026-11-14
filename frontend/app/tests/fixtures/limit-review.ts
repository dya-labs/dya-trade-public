import { DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { previewLimit } from "@/lib/near/domain/limit-preview";
import { limitPreview as limitPreviewSchema, type ExecutableLimitReview } from "@/lib/near/http/schemas/trading";

export function limitPreview() {
  return limitPreviewSchema.parse(previewLimit({ side: "buy", quantity: "1", price: "4", expiryHours: 24 }, {
    accountId: "test-only", checkedAt: Date.now(), blockHeight: 1,
    assets: [DEFAULT_PAIR.base, DEFAULT_PAIR.quote].map(asset => ({ ...asset, raw: `100${"0".repeat(asset.decimals)}`, amount: "100" })),
  }));
}
export function limitReview(fundingExpiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return { ...limitPreview(), submissionEnabled: true as const, orderId: "test-order", fundingAmount: "4", fundingExpiresAt } satisfies ExecutableLimitReview;
}
