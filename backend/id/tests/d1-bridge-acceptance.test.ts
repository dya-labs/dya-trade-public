import { expect, test, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { harness, origin } from "./d1-harness";
import { D1Store } from "../src/near/repositories/d1-store";
import { StatementBudget } from "../src/near/repositories/request-budget";
import { handleNear } from "../src/near/http/api";
import { handleService, completeConnection, completeApproval } from "../src/bridge/service";
import { verifyBridge } from "./fixtures/bridge-verification";

test("complete_bridge_security_flow_on_real_D1_without_provider_mocks", async () => {
  const h = await harness();
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("DYA_TERMINAL_ORIGIN", "http://localhost:3100");
  vi.stubEnv("DYA_SERVICE_SECRET", "synthetic-service-secret"); vi.stubEnv("DYA_ID_D1_QUERY_PROFILE", "free");
  try {
    const evidence = await verifyBridge(origin, async (path, body, cookie = "") => {
      const budget = new StatementBudget("free"), store = new D1Store(h.db, origin, budget);
      const request = new NextRequest(`${origin}${path}`, { method: "POST", headers: { origin, host: "localhost:3101", cookie, "content-type": "application/json", "x-dya-service-secret": "synthetic-service-secret" }, body: JSON.stringify(body) });
      if (path === "/api/service") return handleService(request, store, budget);
      if (path.startsWith("/api/near/")) return handleNear(request, path.slice(10).split("/"), store, undefined, undefined, undefined, budget);
      try {
        const id = path.slice("/api/flow/".length), value = body as { action: string; assertion: unknown };
        const result = value.action === "connect" ? await completeConnection(id, request.cookies.get("near_session")?.value, store, budget) : await completeApproval(id, value.assertion, store, budget);
        return NextResponse.json(result);
      } catch { return NextResponse.json({ error: "Request rejected" }, { status: 400 }); }
    });
    expect(evidence.result).toBe("passed");
  } finally { await h.mf.dispose(); vi.unstubAllEnvs(); }
});
