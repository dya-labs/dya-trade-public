import { NextRequest } from "next/server";
import { handleService } from "../../../../../backend/id/src/bridge/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { return handleService(request); }
