import { afterEach, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "../../../packages/wallet-contracts/src/domain/errors";
import { jsonErrorResponse, routePattern } from "../../../packages/wallet-contracts/src/http/error-response";

const request = (headers: Record<string, string> = {}) => new Request("https://id.example/api/flow/secret-flow-id", { headers });
afterEach(() => vi.restoreAllMocks());

it("answers unexpected errors with a generic reference and logs the details server-side only", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = jsonErrorResponse(request({ "cf-ray": "8f3a2b1c4d5e6f70-AMS" }), "flow", new TypeError("Cannot read properties of undefined (reading 'session')"));
  expect(await response.json()).toEqual({ error: "Something went wrong. Reference: 8f3a2b1c4d5e6f70-AMS", requestId: "8f3a2b1c4d5e6f70-AMS" });
  expect(logged).toHaveBeenCalledWith(expect.objectContaining({ requestId: "8f3a2b1c4d5e6f70-AMS", operation: "flow", name: "TypeError", message: "Cannot read properties of undefined (reading 'session')", stack: expect.any(String) }));
  expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-flow-id");
});

it("logs where malformed client input failed to parse, never the input itself", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const parse of [() => JSON.parse('{"code": hunter2secret}'), () => JSON.parse('{"code":\n"x",\nhunter2secret\n}'), () => BigInt("hunter2secret")]) {
    let failure: unknown;
    try { parse(); } catch (error) { failure = error; }
    const response = jsonErrorResponse(request(), "flow", failure);
    expect((await response.json()).error).toMatch(/^Something went wrong/);
  }
  expect(logged).toHaveBeenCalledWith(expect.objectContaining({ name: "SyntaxError", message: "Malformed input (redacted)", stack: expect.stringContaining("error-response.test.ts") }));
  expect(JSON.stringify(logged.mock.calls)).not.toContain("hunter2secret");
});

it("keeps reviewed messages, but hides catalog entries marked internal", async () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reviewed = await jsonErrorResponse(request(), "auth/register/options", new AppError(ErrorCode.SignOutBeforeCreatingANewPasskeyAccount)).json();
  expect(reviewed).toEqual({ error: "Sign out before creating a new passkey account", code: ErrorCode.SignOutBeforeCreatingANewPasskeyAccount, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(warned).toHaveBeenCalledWith(expect.objectContaining({ code: ErrorCode.SignOutBeforeCreatingANewPasskeyAccount, stack: undefined }));
  const internal = await jsonErrorResponse(request(), "live/preview", new AppError(ErrorCode.OneClickMarketQuotesAreNotConfiguredAddONECLICKJWTToEnableThem)).json();
  expect(internal.error).toBe(`Something went wrong. Reference: ${internal.requestId}`);
  expect(internal.code).toBeUndefined();
});

it("masks route segments that may be bearer values", () => {
  expect(routePattern("trades/Zx81_kQ2aBcd/status")).toBe("trades/:id/status");
  expect(routePattern("auth/login/verify")).toBe("auth/login/verify");
});
