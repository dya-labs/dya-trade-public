import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InsightsMenu } from "@/components/near/insights-menu";
import { readDisplayedEntryPlan, storeEntryAnalysis } from "@/lib/analysis/entry-analysis-history";
import { ENTRY_PLAN_UPDATED_EVENT } from "@/lib/analysis/entry-plan-storage";
import { entryPlan } from "./fixtures/entry-plan";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("shows a retryable history error when browser storage is denied", async () => {
  const denied = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Denied"); });
  render(<InsightsMenu />);
  fireEvent.click(screen.getByRole("button", { name: "Insights" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Insights could not be loaded");
  expect(screen.queryByText(/No insights yet/)).not.toBeInTheDocument();
  denied.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByText(/No insights yet/)).toBeInTheDocument();
});

it("retains history and reports failed read-status and selection writes", async () => {
  storeEntryAnalysis(localStorage, entryPlan(Date.now()), "manual");
  render(<InsightsMenu />);
  await screen.findByRole("button", { name: "Insights, 1 unread" });
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
  fireEvent.click(screen.getByRole("button", { name: "Insights, 1 unread" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Read status could not be saved");
  const updated = vi.fn();
  window.addEventListener(ENTRY_PLAN_UPDATED_EVENT, updated);
  try {
    fireEvent.click(screen.getByRole("button", { name: /Entry plan/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("This insight could not be selected");
    expect(updated).not.toHaveBeenCalled();
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /Entry plan/ }));
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
  } finally { window.removeEventListener(ENTRY_PLAN_UPDATED_EVENT, updated); }
});

it("renders valid history alongside damaged records without crashing", async () => {
  const valid = storeEntryAnalysis(localStorage, entryPlan(Date.now()), "manual");
  localStorage.setItem("nervana:near-entry-analysis-history", JSON.stringify([
    { ...valid, id: "bad-regime", plan: { ...valid.plan, regime: null } },
    { ...valid, id: "bad-date", createdAt: 9e15 }, valid,
  ]));
  render(<InsightsMenu />);
  await screen.findByRole("button", { name: "Insights, 1 unread" });
  fireEvent.click(screen.getByRole("button", { name: "Insights, 1 unread" }));
  expect(await screen.findByRole("button", { name: /Entry plan/ })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("marks visible insights read and preserves that state after remount", async () => {
  const record = storeEntryAnalysis(localStorage, entryPlan(Date.now()), "manual");
  const view = render(<InsightsMenu />);
  fireEvent.click(await screen.findByRole("button", { name: "Insights, 1 unread" }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("nervana:read-insights") ?? "[]")).toEqual([record.id]));
  view.unmount();
  render(<InsightsMenu />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Insights" })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /unread/ })).not.toBeInTheDocument();
});

it("reads new insights arriving while open and shows later arrivals as unread when closed", async () => {
  storeEntryAnalysis(localStorage, entryPlan(Date.now()), "manual");
  render(<InsightsMenu />);
  fireEvent.click(await screen.findByRole("button", { name: "Insights, 1 unread" }));
  await screen.findByRole("button", { name: /Entry plan/ });
  let arriving!: ReturnType<typeof storeEntryAnalysis>;
  act(() => {
    arriving = storeEntryAnalysis(localStorage, entryPlan(Date.now() + 1), "auto");
    window.dispatchEvent(new Event(ENTRY_PLAN_UPDATED_EVENT));
  });
  expect(screen.getAllByRole("button", { name: /Entry plan/ })).toHaveLength(2);
  expect(JSON.parse(localStorage.getItem("nervana:read-insights")!)).toContain(arriving.id);
  fireEvent.click(screen.getByRole("button", { name: "Insights" }));
  act(() => {
    storeEntryAnalysis(localStorage, entryPlan(Date.now() + 2), "auto");
    window.dispatchEvent(new Event(ENTRY_PLAN_UPDATED_EVENT));
  });
  expect(await screen.findByRole("button", { name: "Insights, 1 unread" })).toBeInTheDocument();
});

it("selects an older expired historical plan and restores that selection on reopening", async () => {
  const older = storeEntryAnalysis(localStorage, entryPlan(Date.now() - 60_000), "manual");
  storeEntryAnalysis(localStorage, entryPlan(Date.now()), "auto");
  render(<InsightsMenu />);
  fireEvent.click(await screen.findByRole("button", { name: "Insights, 2 unread" }));
  const records = await screen.findAllByRole("button", { name: /Entry plan/ });
  expect(records[0]).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(records[1]);
  expect(localStorage.getItem("nervana:selected-entry-analysis")).toBe(older.id);
  expect(readDisplayedEntryPlan(localStorage)?.asOf).toBe(older.plan.asOf);
  fireEvent.click(screen.getByRole("button", { name: "Insights" }));
  const reopened = await screen.findAllByRole("button", { name: /Entry plan/ });
  expect(reopened[0]).toHaveAttribute("aria-pressed", "false");
  expect(reopened[1]).toHaveAttribute("aria-pressed", "true");
});

it("opens mobile insights as a controlled dialog without an extra toolbar trigger", async () => {
  const onOpenChange = vi.fn();
  render(<InsightsMenu mobile open onOpenChange={onOpenChange}/>);
  expect(await screen.findByRole("dialog", { name: "Insights" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Insights/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
