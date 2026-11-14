import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ActivityTime, formatActivityTime } from "@/components/near/activity-time";

it("converts UTC to local time across date boundaries using a 24-hour clock", () => {
  expect(formatActivityTime(Date.parse("2026-10-18T17:02:45Z"), "Asia/Bangkok")).toMatchObject({ date: "2026-10-19", time: "00:02:45" });
});
it("uses the timezone offset at the event date, including daylight saving", () => {
  expect(formatActivityTime(Date.parse("2026-07-01T12:00:00Z"), "America/New_York")?.time).toBe("08:00:00");
  expect(formatActivityTime(Date.parse("2026-01-01T12:00:00Z"), "America/New_York")?.time).toBe("07:00:00");
});
it("preserves a machine-readable UTC timestamp and exposes local timezone on hover", () => {
  render(<ActivityTime value={Date.parse("2026-10-18T17:02:45Z")} updated />);
  const time = screen.getByText(/last updated/).closest("time")!;
  expect(time).toHaveAttribute("dateTime", "2026-10-18T17:02:45.000Z");
  expect(time.title).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(time.title).toContain("UTC: 2026-10-18T17:02:45.000Z");
  expect(renderToString(<ActivityTime value={0} />)).toContain("Loading local time");
});
it("leaves missing or invalid timestamps unavailable", () => {
  expect(formatActivityTime(NaN, "Asia/Bangkok")).toBeNull();
  expect(formatActivityTime(9e15, "Asia/Bangkok")).toBeNull();
});
