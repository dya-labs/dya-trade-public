import type { z } from "zod";

/** Validated JSON preferences. Storage failures never prevent using the app. */
export function createStoragePreference<T>(storage: "localStorage" | "sessionStorage", key: string, schema: z.ZodType<T>) {
  return {
    read(): T | undefined {
      try {
        if (typeof window === "undefined") return undefined;
        const raw = window[storage].getItem(key);
        if (raw === null) return undefined;
        const parsed = schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch { return undefined; }
    },
    write(value: T): boolean {
      try {
        if (typeof window === "undefined") return false;
        window[storage].setItem(key, JSON.stringify(schema.parse(value)));
        return true;
      } catch { return false; }
    },
    remove(): void {
      try { if (typeof window !== "undefined") window[storage].removeItem(key); } catch { /* Storage is optional. */ }
    },
  };
}

/** Preferences that survive browser restarts. */
export function createLocalPreference<T>(key: string, schema: z.ZodType<T>) {
  return createStoragePreference("localStorage", key, schema);
}

/** Preferences scoped to the current browser tab. */
export function createSessionPreference<T>(key: string, schema: z.ZodType<T>) {
  return createStoragePreference("sessionStorage", key, schema);
}
