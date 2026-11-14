// Catalog and icons come from DYA ID (shared with the ID app); market metadata comes straight from the data API.
import { dataApi } from "@/lib/market-data/hooks";
export * from "@dya/wallet-ui/lib/near/http/catalog-client";
export const getTokenMarkets = (signal?: AbortSignal) => dataApi.tokenMarkets(signal);

export const getTokenLinks = (signal?: AbortSignal) => dataApi.tokenLinks(signal);
