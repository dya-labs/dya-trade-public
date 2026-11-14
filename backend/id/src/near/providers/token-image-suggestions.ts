import { readDataApiIcons } from "./token-icons";

/** Cache the public metadata snapshot without requiring a Next request/cache context. */
export function createTokenImageReader(reader = readDataApiIcons, now = Date.now) {
  let cached: Record<string, string> = {}, until = 0, pending: Promise<void> | undefined;
  return async (): Promise<Record<string, string>> => {
    if (now() >= until) {
      pending ??= (async () => {
        try { cached = await reader(); until = now() + 10 * 60_000; }
        catch { until = now() + 60_000; }
      })().finally(() => { pending = undefined; });
      await pending;
    }
    return { ...cached };
  };
}
export const readTokenImageSuggestions = createTokenImageReader();
