// @vitest-environment node
import { limitPreview as responseSchema } from "@/lib/near/http/schemas/trading";
import { describe, it, expect } from "vitest";
import { ASSETS } from "@/lib/near/domain/assets";
import { readBalances } from "../../../backend/id/src/near/providers/live";
import { previewLimit } from "@/lib/near/domain/limit-preview";
const account = `0x${"a".repeat(40)}`;
function rpc(amounts: unknown) { return new Response(JSON.stringify({ result: { block_height: 123, result: [...Buffer.from(JSON.stringify(amounts))] } })); }
async function balances() { return readBalances(account, async () => rpc(["1000000000000000000000001", "4000000"])); }
describe("real NEAR balances and order previews", () => {
  it("queries only fixed assets and preserves 24-decimal balances", async () => {
    const result = await readBalances(account, async (_url, init) => {
      const call = JSON.parse(init!.body as string);
      expect(call.params.method_name).toBe("mt_batch_balance_of");
      expect(JSON.parse(Buffer.from(call.params.args_base64, "base64").toString())).toEqual({ account_id: account, token_ids: ASSETS.map(a => a.assetId) });
      return rpc(["1000000000000000000000001", "4000000"]);
    });
    expect(result.assets[0].amount).toBe("1.000000000000000000000001");
  });
  it("never substitutes zero for malformed balances or provider failure", async () => {
    for (const invalid of [["0"], [0, "0"], ["-1", "0"], ["1.5", "0"], [(BigInt(1) << BigInt(128)).toString(), "0"]]) await expect(readBalances(account, async () => rpc(invalid))).rejects.toThrow();
    await expect(readBalances(account, async () => new Response("", { status: 503 }))).rejects.toThrow();
  });
  it("rounds quote principal up and binds recipients to the balance identity", async () => {
    const p = previewLimit({ side: "buy", quantity: "1.000001", price: "4.000001", expiryHours: 24, recipient: "attacker.near" }, await balances(), 0);
    expect(() => responseSchema.parse(JSON.parse(JSON.stringify(p)))).not.toThrow();
    expect(p.principal).toBe("4.000006"); expect(p.shortfall).toBe("0.000006");
    expect(p.request.data.attributes.recipient).toBe(account);
    expect(p.request.data.attributes.quantity).toBe("1000001000000000000000000");
    expect(p.submissionEnabled).toBe(false);
  });
  it("uses NEAR principal for sells and rejects unsupported precision or expiry", async () => {
    const b = await balances();
    expect(previewLimit({ side: "sell", quantity: "1", price: "4", expiryHours: 1 }, b).shortfall).toBe("0");
    for (const patch of [{ quantity: "1e2" }, { price: "0" }, { quantity: "0.0000000000000000000000001" }, { expiryHours: 2 }, { side: "oops" }]) expect(() => previewLimit({ side: "buy", quantity: "1", price: "4", expiryHours: 24, ...patch }, b)).toThrow();
  });
});
