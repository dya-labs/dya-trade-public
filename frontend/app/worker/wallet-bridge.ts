import { isJsonContentType, parseJsonObject, readRequestText } from "../../../packages/wallet-contracts/src/http/request-validation";
import { createHash, randomBytes } from "node:crypto";
import { getDeploymentConfig } from "./config";
import { AppError, ErrorCode } from "../../../packages/wallet-contracts/src/domain/errors";
import { jsonErrorResponse, logRequestError, requestIdOf, routePattern } from "../../../packages/wallet-contracts/src/http/error-response";

const GRANT = "dya_wallet_grant_v1", FLOW = "dya_wallet_flow_v1";
/** Preparations the ticket confirms at once: ID creates their approval flow with the ceremony. */
const IMMEDIATE_APPROVALS = new Set(["live/market/prepare", "live/orders/prepare"]);
function config() {
  const app = getDeploymentConfig(), origin = new URL(process.env.DYA_ID_ORIGIN || "http://localhost:3101");
  if (origin.origin !== (process.env.DYA_ID_ORIGIN || "http://localhost:3101") || (app.hosted && origin.protocol !== "https:")) throw new Error("DYA_ID_ORIGIN must be a fixed wallet origin");
  const secret = process.env.DYA_SERVICE_SECRET || (!app.hosted ? "dya-local-service-development-only" : "");
  if (!secret || (app.hosted && secret.length < 32)) throw new Error("Wallet service is not configured");
  return { app, origin: origin.origin, secret };
}
function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}
function setCookie(response: Response, name: string, value: string, maxAge: number) {
  const secure = getDeploymentConfig().secure ? "; Secure" : "";
  response.headers.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Lax`);
  return response;
}
async function service(input: unknown) {
  const c = config();
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-dya-service-secret": c.secret };
  if (c.app.password) headers.authorization = `Basic ${Buffer.from(`tester:${c.app.password}`).toString("base64")}`;
  const response = await fetch(`${c.origin}/api/service`, { method: "POST", headers, body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(25000), redirect: "manual" });
  // Workers supports manual redirects; never forward service credentials to a redirect target.
  if (response.status >= 300 && response.status < 400) throw new Error("Wallet service redirects are not allowed");
  return response;
}
export async function proxyWallet(request: Request, path: string) {
  let stage = "configuration";
  try {
    config();
    stage = "request";
    if (request.method === "POST" && (request.headers.get("origin") !== config().app.origin || !isJsonContentType(request.headers.get("content-type")))) return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
    const raw = request.method === "POST" ? await readRequestText(request, 20000) : undefined;
    if (raw === null) return Response.json({ error: "Request too large" }, { status: 413 });
    const body = request.method === "POST" ? parseJsonObject(raw ?? "") : undefined;
    const session = readCookie(request, GRANT);
    if (path === "auth/logout") {
      const result = await service({ operation: "request", path: "connection/revoke", body: {}, session });
      return setCookie(Response.json(await result.json(), { status: result.status }), GRANT, "", 0);
    }
    const receipt = typeof body?.dyaApproval === "string" ? body.dyaApproval : undefined;
    // `walletFlow: true` asks ID for the hosted approval flow along with the prepared ceremony,
    // bound to a verifier kept here as for /api/wallet/flow.
    let verifier: string | undefined;
    if (body?.walletFlow === true && IMMEDIATE_APPROVALS.has(path)) verifier = randomBytes(32).toString("base64url");
    if (body) delete body.walletFlow;
    stage = "service-fetch";
    const serviceStarted = performance.now(), sentAt = Date.now();
    const response = await service(receipt ? { operation: "receipt", path: path + new URL(request.url).search, session, flowId: receipt } : { operation: "request", path: path + new URL(request.url).search, body, session, ...(verifier ? { approvalFlow: { verifierHash: createHash("sha256").update(verifier).digest("base64url") } } : {}) });
    const serviceDuration = performance.now() - serviceStarted, receivedAt = Date.now();
    // ID reports its own wall-clock span, which splits the wait into the way there and the way back
    // (both Workers' clocks only advance on I/O and are synchronized to a few milliseconds).
    const clock = /^(\d{13}),(\d{13})$/.exec(response.headers.get("X-DYA-Service-Clock") ?? "");
    const legs = clock ? [`wallet_uplink;dur=${Number(clock[1]) - sentAt}`, `wallet_downlink;dur=${receivedAt - Number(clock[2])}`] : [];
    stage = "response-json";
    const data: unknown = await response.json();
    // Correlates with the ID Worker's own log event through its request ID.
    if (!response.ok) console.error({ event: "wallet.bridge.response", requestId: requestIdOf(request), status: response.status, operation: routePattern(path), idRequestId: typeof data === "object" && data !== null && "requestId" in data ? data.requestId : undefined });
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (path === "live/preview" || IMMEDIATE_APPROVALS.has(path)) headers.set("Server-Timing", [response.headers.get("Server-Timing"), `wallet_service;dur=${serviceDuration.toFixed(1)}`, ...legs].filter(Boolean).join(", "));
    if (response.headers.has("Retry-After")) headers.set("Retry-After", response.headers.get("Retry-After")!);
    const result = Response.json(data, { status: response.status, headers });
    const flowId = verifier && response.ok && typeof data === "object" && data !== null && "walletFlow" in data && typeof data.walletFlow === "object" && data.walletFlow !== null && "flowId" in data.walletFlow ? data.walletFlow.flowId : undefined;
    return typeof flowId === "string" ? setCookie(result, FLOW, JSON.stringify({ id: flowId, verifier, action: "approval" }), 300) : result;
  } catch (error) {
    if (stage === "request" && error instanceof AppError) return jsonErrorResponse(request, `bridge:${routePattern(path)}`, error);
    const requestId = requestIdOf(request);
    logRequestError({ requestId, operation: `bridge:${stage}`, status: 503, error, expected: false });
    return Response.json({ error: "DYA ID is unavailable. Check the wallet service and try again.", requestId }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export async function handleWalletBridge(request: Request, path: string) {
  try {
    const c = config();
    if (path !== "callback" && (request.method !== "POST" || request.headers.get("origin") !== c.app.origin || !isJsonContentType(request.headers.get("content-type")))) return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
    // proxyWallet reads the body itself; a request body can only be read once.
    if (path === "disconnect") return proxyWallet(request, "auth/logout");
    const raw = path === "callback" ? "{}" : await readRequestText(request, 5000); if (raw === null) throw new AppError(ErrorCode.RequestTooLarge);
    const body = parseJsonObject(raw);
    if (path === "flow") {
      const verifier = randomBytes(32).toString("base64url"), verifierHash = createHash("sha256").update(verifier).digest("base64url");
      const response = await service({ operation: "flow", body: { ...body, verifierHash }, session: readCookie(request, GRANT) });
      const data = await response.json();
      const result = Response.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
      if (response.ok) setCookie(result, FLOW, JSON.stringify({ id: data.flowId, verifier, action: body.action }), 300);
      return result;
    }
    if (path === "exchange" || path === "callback") {
      const pending = JSON.parse(readCookie(request, FLOW) || "null");
      const params = new URL(request.url).searchParams;
      const flowId = path === "callback" ? params.get("flowId") : body.flowId;
      const code = path === "callback" ? params.get("code") : body.code;
      if (!pending || pending.id !== flowId) throw new AppError(ErrorCode.WalletCallbackDoesNotMatchThisBrowserRequest);
      let session: string | undefined, state: unknown;
      if (pending.action === "connect") {
        const response = await service({ operation: "exchange", flowId, code, verifier: pending.verifier });
        const data = await response.json();
        // The ID service's body is already client-safe (reviewed message or reference).
        if (!response.ok) return Response.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
        session = data.session; state = data.state;
      }
      // The browser gets the account snapshot, never the grant, which stays in the HttpOnly cookie.
      const result = path === "callback" ? new Response(null, { status: 303, headers: { Location: new URL("/", c.app.origin).href } }) : Response.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
      if (session) setCookie(result, GRANT, session, 12 * 60 * 60);
      return setCookie(result, FLOW, "", 0);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) { return jsonErrorResponse(request, `wallet/${routePattern(path)}`, error); }
}
