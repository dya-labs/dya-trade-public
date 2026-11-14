// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "@dya/ui/components/app-error-boundary";

function Crash(): never { throw new Error("render failed"); }
afterEach(() => { vi.restoreAllMocks(); });

it("replaces a crashed tree with the recovery screen and logs the error", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<AppErrorBoundary><Crash /></AppErrorBoundary>);
  expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
  expect(log.mock.calls.some(([error]) => error instanceof Error && error.message === "render failed")).toBe(true);
});
