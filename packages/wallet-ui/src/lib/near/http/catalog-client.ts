import { z } from "zod";
import { tokenSchema } from "../../../../../wallet-contracts/src/domain/token-registry";
import { networkSchema } from "../../../../../wallet-contracts/src/domain/networks";
import { catalogSchema } from "../domain/catalog";
import { request } from "./request";
import { tokenIconsSchema } from "../domain/token-icons";
export const getCatalog = (signal?: AbortSignal) => request("catalog", z.object({ assets: catalogSchema, tokens: z.array(tokenSchema).optional(), networks: z.array(networkSchema).optional() }), undefined, signal);
export const getTokenIcons = (signal?: AbortSignal) => request("token-icons", z.object({ icons: tokenIconsSchema }), undefined, signal);
export const getNetworkIcons = (signal?: AbortSignal) => request("network-icons", z.object({ icons: tokenIconsSchema }), undefined, signal);
