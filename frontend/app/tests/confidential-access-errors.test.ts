// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { request } from "@/lib/near/http/request";
import { ConfidentialAccessRequired } from "@/lib/near/domain/confidential-access-error";
afterEach(() => vi.unstubAllGlobals());
it("distinguishes expired private access from generic balance errors in the client", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Confirm your passkey", code: "CONFIDENTIAL_ACCESS_REQUIRED" }, { status: 401 })));
  await expect(request("live/balances", z.object({}))).rejects.toBeInstanceOf(ConfidentialAccessRequired);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Provider unavailable" }, { status: 503 })));
  try { await request("live/balances", z.object({})); throw new Error("Expected failure"); }
  catch (error) { expect(error).not.toBeInstanceOf(ConfidentialAccessRequired); expect((error as Error).message).toBe("Provider unavailable"); }
});

it("preserves enum-classified remote errors without trusting unknown codes", async () => {
  const { ErrorCode } = await import("@/lib/near/domain/errors");
  for (const code of [ErrorCode.LimitOrderAmountTooSmall, "UNKNOWN_PROVIDER_CODE"]) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Minimum order value is $0.10", code }, { status: 400 })));
    await expect(request("live/orders/prepare", z.object({}))).rejects.toMatchObject({
      code: ErrorCode.RemoteRequestFailed,
      remoteCode: code === ErrorCode.LimitOrderAmountTooSmall ? code : undefined,
      message: "Minimum order value is $0.10",
    });
  }
});

it("retains the structured USD minimum only for its reviewed enum", async () => {
  const { ErrorCode } = await import("@/lib/near/domain/errors");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Amount too small", code: ErrorCode.LimitOrderAmountTooSmall, minimumUsd: "0.10" }, { status: 400 })));
  await expect(request("live/orders/prepare", z.object({}))).rejects.toMatchObject({ remoteCode: ErrorCode.LimitOrderAmountTooSmall, minimumUsd: "0.10" });
});
