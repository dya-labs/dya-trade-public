import { request } from "./request";
import * as schema from "./schemas/market";

export const analyzeEntry = (assetId: string, signal?: AbortSignal) => request("analysis/entry", schema.entryPlan, { assetId }, signal);
