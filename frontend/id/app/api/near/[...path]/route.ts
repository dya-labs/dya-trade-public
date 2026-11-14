import { NextRequest } from "next/server";
import { handleNear } from "../../../../../../backend/id/src/near/http/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handleNear(request, (await context.params).path);
}
export const GET = handle;
export const POST = handle;
