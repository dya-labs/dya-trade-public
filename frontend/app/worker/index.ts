import { isJsonContentType, parseJsonObject, readRequestText } from "../../../packages/wallet-contracts/src/http/request-validation";
import { z } from "zod";
import { createMarketEntryPlan } from "@/lib/analysis/market-entry-analysis";
import { assertJevConfigured } from "@/lib/analysis/entry-analysis";
import { catalogSchema, DEFAULT_PAIR } from "@/lib/near/domain/catalog";
import { checkInternalAccess } from "./access";
import { jevChat } from "./jev-chat";
import { getDeploymentConfig } from "./config";
import { handleWalletBridge, proxyWallet } from "./wallet-bridge";
import { AppError, ErrorCode } from "../../../packages/wallet-contracts/src/domain/errors";
import { jsonErrorResponse } from "../../../packages/wallet-contracts/src/http/error-response";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const noStore = { "Cache-Control": "no-store" };

async function entryAnalysis(request: Request) {
  try {
    if (request.method !== "POST" || request.headers.get("origin") !== getDeploymentConfig().origin || !isJsonContentType(request.headers.get("content-type"))) return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
    const raw = await readRequestText(request, 20000); if (raw === null) throw new AppError(ErrorCode.RequestTooLarge);
    const body = parseJsonObject(raw);
    assertJevConfigured();
    const response = await proxyWallet(new Request(new URL("/api/near/catalog", request.url), { headers: request.headers }), "catalog");
    if (!response.ok) return response;
    const catalog = z.object({ assets: catalogSchema }).parse(await response.json());
    const asset = catalog.assets.find(item => item.assetId === (body.assetId ?? DEFAULT_PAIR.base.assetId));
    if (!asset) throw new AppError(ErrorCode.UnsupportedAsset);
    return Response.json(await createMarketEntryPlan(asset), { headers: noStore });
  } catch (error) { return jsonErrorResponse(request, "analysis/entry", error); }
}

async function api(request: Request, url: URL) {
  const route = /^\/api\/(wallet|near)\/(.+)$/.exec(url.pathname);
  let path = "";
  // Catch-all segments, decoded like the former Next `[...path]` params.
  try { path = route?.[2].split("/").filter(Boolean).map(decodeURIComponent).join("/") ?? ""; } catch { /* malformed escape: not found */ }
  if (!route || !path) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  if (request.method !== "GET" && request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  if (route[1] === "wallet") return handleWalletBridge(request, path);
  if (path === "jev/chat") return jevChat(request);
  return path === "analysis/entry" ? entryAnalysis(request) : proxyWallet(request, path);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The gate covers the page, assets, and APIs; no public route bypass while internal.
    const denied = checkInternalAccess(request);
    if (denied) return denied;
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return api(request, url);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(asset.body, { status: asset.status, headers });
  },
};
export default worker;
