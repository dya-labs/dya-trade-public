// @vitest-environment node
import { expect, it } from "vitest";
import { AppError, ErrorCode } from "@/lib/near/domain/errors";
import { verifyAssertion } from "../../../backend/id/src/near/auth/passkeys";
import { ProviderError } from "../../../backend/id/src/near/providers/one-click";

it("classifies account mismatch without changing the public message", async () => {
  await expect(verifyAssertion({ id: "account", kind: "passkey" }, {} as Parameters<typeof verifyAssertion>[1], "challenge"))
    .rejects.toMatchObject({ code: ErrorCode.PasskeyAccountMismatch, message: "Passkey does not belong to this account" });
});

it("formats parameterized errors and remains compatible with Error handlers", () => {
  const error = new AppError(ErrorCode.PasskeyOriginRequired, "https://example.test");
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe("Open https://example.test to use passkeys.");
  expect(error.code).toBe(ErrorCode.PasskeyOriginRequired);
});

it("directs uncertain market submissions to their My trades history", () => {
  expect(new AppError(ErrorCode.SubmissionOutcomeIsUnknownCheckOrdersBeforeRetrying).message).toBe("Submission outcome is unknown. Check My trades before retrying.");
});

it("preserves provider outcome and upstream code independently", () => {
  const unknown = new ProviderError(0, "transport-error", true);
  expect(unknown).toMatchObject({ code: "transport-error", outcomeUnknown: true, errorCode: ErrorCode.ProviderOutcomeUnknown });
  const rejected = new ProviderError(429, "rate-limit-exceeded", false, 30);
  expect(rejected).toMatchObject({ errorCode: ErrorCode.ProviderRequestFailed, retryAfterSeconds: 30 });
  expect(rejected.message).toBe("1Click request failed (429, rate-limit-exceeded)");
});
