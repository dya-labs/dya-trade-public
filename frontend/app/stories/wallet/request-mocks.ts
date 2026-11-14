import type { z } from "zod";
import { dashboardMode } from "./dashboard-api-mocks";
import { fundingHistory, walletState } from "./api-mocks";

// Operation history uses the transport directly, rather than the mocked clients.
export async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  if ((dashboardMode === "activity-unavailable" || dashboardMode === "partial-activity-error") || walletState === "ActivityUnavailable") throw new Error("Demo activity unavailable");
  if (walletState === "Loading") return new Promise<T>(() => {});
  if (path === "live/trades") return schema.parse({ trades: [] });
  if (path === "funding/history") return schema.parse(await fundingHistory());
  throw new Error(`No Storybook fixture for ${path}`);
}
