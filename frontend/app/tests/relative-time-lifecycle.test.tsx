import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RelativeTime } from "@dya/wallet-ui/components/relative-time";
const now = Date.UTC(2026, 9, 17, 12);
beforeEach(() => { vi.useFakeTimers();vi.setSystemTime(now);vi.spyOn(document, "hidden", "get").mockReturnValue(false); });
afterEach(() => { cleanup();vi.restoreAllMocks();vi.useRealTimers(); });
it("updates recent activity each minute while preserving exact timestamp metadata", async () => {
  const timestamp = now - 59_000;
  render(<RelativeTime timestamp={timestamp} />);
  expect(screen.getByText("Just now")).toHaveAttribute("datetime", new Date(timestamp).toISOString());
  expect(screen.getByText("Just now")).toHaveAttribute("title", new Date(timestamp).toLocaleString());
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.getByText("1m ago")).toHaveAttribute("datetime", new Date(timestamp).toISOString());
});
it("pauses hidden-page labels and refreshes immediately on becoming visible", async () => {
  const hidden = vi.spyOn(document, "hidden", "get");
  render(<RelativeTime timestamp={now - 60_000} />);
  hidden.mockReturnValue(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(screen.getByText("1m ago")).toBeInTheDocument();
  hidden.mockReturnValue(false);act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(screen.getByText("3m ago")).toBeInTheDocument();
});
it("switches from relative to calendar date exactly at one week", async () => {
  const timestamp = now - 7 * 86400000 + 60_000;
  render(<RelativeTime timestamp={timestamp} />);expect(screen.getByText("6d ago")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(screen.getByText(new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }))).toBeInTheDocument();
});
it("includes the year for older activity from another calendar year", () => {
  const timestamp = Date.UTC(2025, 11, 15, 12);
  render(<RelativeTime timestamp={timestamp} />);
  expect(screen.getByText(new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))).toHaveAttribute("datetime", new Date(timestamp).toISOString());
});
it("uses a replaced timestamp without waiting for a timer tick", () => {
  const view = render(<RelativeTime timestamp={now - 60_000} />);
  view.rerender(<RelativeTime timestamp={now - 2 * 3600000} />);
  expect(screen.getByText("2h ago")).toHaveAttribute("datetime", new Date(now - 2 * 3600000).toISOString());
});
it("removes its timer and visibility listener when activity unmounts", () => {
  const remove = vi.spyOn(document, "removeEventListener");const view = render(<RelativeTime timestamp={now} />);
  expect(vi.getTimerCount()).toBe(1);view.unmount();expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
});
it.each([NaN, Infinity, 9e15])("shows unavailable time instead of crashing on timestamp %s", timestamp => {
  const view = render(<RelativeTime timestamp={timestamp} />);
  expect(screen.getByTitle("Time unavailable")).toHaveTextContent("-");expect(view.container.querySelector("time")).toBeNull();
});
it("keeps full detail timestamps exact without starting a refresh timer", () => {
  const timestamp = now - 60_000;
  render(<RelativeTime timestamp={timestamp} format="full" />);
  expect(screen.getByText(new Date(timestamp).toLocaleString())).toHaveAttribute("datetime", new Date(timestamp).toISOString());
  expect(vi.getTimerCount()).toBe(0);
});
it("preserves calendar-only table dates and full tooltip metadata without a timer", () => {
  const timestamp = Date.UTC(2025, 11, 15, 12);
  render(<RelativeTime timestamp={timestamp} format="date" />);
  const time = screen.getByText(new Date(timestamp).toLocaleDateString());
  expect(time).toHaveAttribute("datetime", new Date(timestamp).toISOString());
  expect(time).toHaveAttribute("title", new Date(timestamp).toLocaleString());
  expect(vi.getTimerCount()).toBe(0);
});
