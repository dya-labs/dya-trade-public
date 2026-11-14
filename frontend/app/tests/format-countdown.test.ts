import { expect, it } from "vitest";
import { formatCountdown } from "@dya/ui/lib/format-countdown";

it("counts down using the supplied clock and rounds partial seconds up", () => {
  expect(formatCountdown(900_000, 0).text).toBe("15:00");
  expect(formatCountdown(900_000, 1_000).text).toBe("14:59");
  expect(formatCountdown(1_001, 0).text).toBe("00:02");
});
it("clamps expired deadlines and pluralizes accessible descriptions", () => {
  expect(formatCountdown(61_000, 0)).toEqual({ text: "01:01", description: "1 minute 1 second" });
  expect(formatCountdown(0, 1_000)).toEqual({ text: "00:00", description: "0 minutes 0 seconds" });
});
it("handles invalid clocks without displaying NaN", () => {
  expect(formatCountdown(NaN, 0).text).toBe("—");
  expect(formatCountdown(0, Infinity).description).toBe("Time unavailable");
});

it("adapts long deadlines and switches units at hour and day boundaries", () => {
  expect(formatCountdown(259_200_000, 0)).toEqual({ text: "3d 0h", description: "3 days 0 hours" });
  expect(formatCountdown(259_200_000, 1_000).text).toBe("2d 23h");
  expect(formatCountdown(86_400_000, 0)).toEqual({ text: "1d 0h", description: "1 day 0 hours" });
  expect(formatCountdown(86_399_000, 0).text).toBe("23h 59m");
  expect(formatCountdown(3_660_000, 0)).toEqual({ text: "1h 1m", description: "1 hour 1 minute" });
  expect(formatCountdown(3_600_000, 0).text).toBe("1h 0m");
  expect(formatCountdown(3_599_000, 0).text).toBe("59:59");
});
