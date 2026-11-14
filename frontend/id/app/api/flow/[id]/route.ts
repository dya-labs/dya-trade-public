import { isJsonContentType, readRequestText } from "../../../../../../packages/wallet-contracts/src/http/request-validation";
import { errorResponse } from "../../../../../../backend/id/src/near/http/storage-response";
import { AppError, ErrorCode } from "../../../../../../packages/wallet-contracts/src/domain/errors";
import { NextRequest, NextResponse } from "next/server";
import { completeConnection, completeApproval } from "../../../../../../backend/id/src/bridge/service";
import { getDeploymentConfig } from "../../../../../../backend/id/src/deployment/config";
import { SESSION } from "../../../../../../backend/id/src/near/services/workflow-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== getDeploymentConfig().origin || !isJsonContentType(request.headers.get("content-type"))) return NextResponse.json({ error: "Same-origin JSON request required" }, { status: 403 });
    const raw = await readRequestText(request, 20000); if (raw === null) throw new AppError(ErrorCode.RequestTooLarge);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new AppError(ErrorCode.InvalidRequest); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !("action" in body)) throw new AppError(ErrorCode.InvalidRequest);
    const input = body as Record<string, unknown>;
    if (input.action !== "connect" && input.action !== "approve") throw new AppError(ErrorCode.InvalidRequest);
    if (input.action === "approve" && (!input.assertion || typeof input.assertion !== "object" || Array.isArray(input.assertion))) throw new AppError(ErrorCode.InvalidRequest);
    const { id } = await context.params;
    const data = input.action === "connect" ? await completeConnection(id, request.cookies.get(SESSION)?.value) : await completeApproval(id, input.assertion);
    if ("retryAfter" in data) return NextResponse.json(data.body, { status: data.status, headers: { "Cache-Control": "no-store", "Retry-After": data.retryAfter ?? "1" } });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(request, "flow", error); }
}
