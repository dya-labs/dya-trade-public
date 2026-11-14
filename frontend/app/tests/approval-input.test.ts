// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../id/app/api/flow/[id]/route";
import { completeApproval, completeConnection } from "../../../backend/id/src/bridge/service";
vi.mock("../../../backend/id/src/bridge/service", () => ({ completeApproval: vi.fn(), completeConnection: vi.fn() }));
beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3101");
  vi.mocked(completeConnection).mockResolvedValue({ code: "synthetic", callback: "http://localhost:3100/", clientOrigin: "http://localhost:3100" });
  vi.mocked(completeApproval).mockResolvedValue({ status: 200, body: { ok: true }, callback: "http://localhost:3100/", clientOrigin: "http://localhost:3100" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllEnvs(); });
const call = (body: string) => POST(new NextRequest("http://localhost:3101/api/flow/synthetic", { method: "POST", headers: { origin: "http://localhost:3101", "content-type": "application/json" }, body }), { params: Promise.resolve({ id: "synthetic" }) });
it.each(["{", "null", "[]", '"approve"', "42", "{}", '{"action":"typo"}', '{"action":"approve"}', '{"action":"approve","assertion":null}', '{"action":"approve","assertion":[]}', '{"action":"approve","assertion":"proof"}'])("rejects malformed confirmation %s before claiming the flow", async body => {
  const response = await call(body);
  expect(response.status).toBe(400);
  const result = await response.json();expect(result.error).toBe("Invalid request");expect(result.requestId).toBeTruthy();
  expect(completeApproval).not.toHaveBeenCalled();expect(completeConnection).not.toHaveBeenCalled();
});
it("dispatches only an explicit connect action", async () => {
  const response = await call('{"action":"connect"}');
  expect(response.status).toBe(200);expect(completeConnection).toHaveBeenCalledOnce();expect(completeApproval).not.toHaveBeenCalled();
});
it("forwards an explicit approval object unchanged for cryptographic verification", async () => {
  const assertion = { id: "synthetic", response: { signature: "not-a-real-proof" } };
  const response = await call(JSON.stringify({ action: "approve", assertion }));
  expect(response.status).toBe(200);expect(completeApproval).toHaveBeenCalledWith("synthetic", assertion);expect(completeConnection).not.toHaveBeenCalled();
});
