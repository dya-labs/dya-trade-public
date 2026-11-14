// @vitest-environment node
import { expect, it } from "vitest";
import { selectMarketSlippage } from "../../../backend/id/src/near/services/slippage";

it("uses the fixed 30 bps default, including legacy Auto requests", () => {
  for (const setting of [undefined, { mode: "default" }, { mode: "auto" }])
    expect(selectMarketSlippage(setting)).toEqual({ bps: 30, policy: { mode: "default" } });
});
it("preserves exact custom tolerances and rejects invalid values", () => {
  for (const bps of [1, 27, 500])
    expect(selectMarketSlippage({ mode: "custom", bps })).toEqual({ bps, policy: { mode: "custom" } });
  for (const bps of [0, -1, 501, 1.5, "30", NaN, Infinity])
    expect(() => selectMarketSlippage({ mode: "custom", bps })).toThrow();
  expect(() => selectMarketSlippage({ mode: "unknown" })).toThrow();
});
