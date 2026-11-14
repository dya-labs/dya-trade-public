import { expect, it, vi } from "vitest";
import { providerFetch, oneClickHeaders } from "../../../backend/id/src/near/providers/http";
import { ErrorCode } from "@/lib/near/domain/errors";
it("never retries mutations or exposes transport secrets", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("private bearer token"));
  await expect(providerFetch(fetcher, "https://example.test", { method: "POST" }))
    .rejects.toMatchObject({ code: ErrorCode.ProviderTransportUnavailable });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", cache: "no-store" });
});
it("rejects redirects without forwarding credentials or retrying", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://other.example" } }));
  await expect(providerFetch(fetcher, "https://example.test", { headers: { Authorization: "Bearer test" } })).rejects.toMatchObject({ code: ErrorCode.ProviderTransportUnavailable });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("keeps order API keys distinct from bearer credentials", () => {
  expect(oneClickHeaders("test", "api-key")).toHaveProperty("X-API-Key", "test");
  expect(oneClickHeaders("test")).toHaveProperty("Authorization", "Bearer test");
});
