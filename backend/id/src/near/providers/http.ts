import { AppError, ErrorCode } from "../../../../../packages/wallet-contracts/src/domain/errors";

export const ONE_CLICK_BASE = "https://1click.chaindefuser.com";
export function oneClickHeaders(credential: string, mode: "bearer" | "api-key" = "bearer") {
  return { "Content-Type": "application/json", ...(mode === "bearer"
    ? { Authorization: `Bearer ${credential}` }
    : { "X-API-Key": credential }) };
}

/** One attempt only: even quote POSTs may allocate a provider-side operation. */
export async function providerFetch(fetcher: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetcher(url, {
      ...init, cache: "no-store", redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("Provider redirect rejected");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const category = ["redirect", "timeout", "abort", "certificate", "dns", "cache", "fetch", "connection"].find(value => message.includes(value)) ?? "unknown";
    console.error("terminal.provider.transport", { category });
    // Never propagate URL/headers/body or arbitrary transport error messages.
    throw new AppError(ErrorCode.ProviderTransportUnavailable);
  }
}
