// @vitest-environment node
import { expect, it } from "vitest";
import { quoteRejection } from "../../../backend/id/src/near/providers/quote-rejection";

it("bounds and sanitizes provider diagnostic text", () => {
  const result = quoteRejection({ message: "No route\nhttps://example.test/private alice.near " + "a".repeat(64) + " ".repeat(1000), headers: { Authorization: "not selected" } });
  expect(result.reason).toContain("No route [url] [account] [identifier]");
  expect(result.reason.length).toBeLessThanOrEqual(300);
  expect(result.reason).not.toContain("not selected");
});
it("omits structured echoes and handles missing or malformed fields", () => {
  expect(quoteRejection({ message: '{"secret":"private"}' }).reason).toBe("Provider returned a structured error; details omitted");
  expect(quoteRejection({ message: ["private"] }).reason).toBe("No textual rejection reason returned");
  expect(quoteRejection(null).providerCode).toBeUndefined();
});
