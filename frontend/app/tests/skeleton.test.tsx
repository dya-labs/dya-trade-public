import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableSkeletonRows } from "@dya/ui/components/table-skeleton";
import { Skeleton } from "@dya/ui/components/skeleton";
import { Table, TableBody, TableCell, TableRow, TableHeader, TableHead } from "@dya/ui/components/table";

afterEach(cleanup);

describe("shared measured Skullet skeleton", () => {
  it("hides sample values until real data arrives", async () => {
    const content = (balance: string) => <output aria-label="Balance">{balance}</output>;
    const { container, rerender } = render(<Skeleton data={null as string | null} sample="1000" label="Loading balance">{content}</Skeleton>);
    expect(screen.getByText("Loading balance")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Balance" })).toBeNull();
    expect(container.querySelector("[skullet-loading]")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[skullet-loading]")).toHaveAttribute("inert");
    expect(container.querySelector("[skullet-reveal]")).toHaveAttribute("aria-busy", "true");
    rerender(<Skeleton data="1250.50" sample="1000" label="Loading balance">{content}</Skeleton>);
    expect(await screen.findByRole("status", { name: "Balance" })).toHaveTextContent("1250.50");
    await waitFor(() => expect(container.querySelector("[skullet-loading]")).toBeNull());
    expect(screen.queryByText("1000")).toBeNull();
    expect(container.querySelector("[skullet-reveal]")).not.toHaveAttribute("aria-busy");
  });

  it("keeps headers and column widths while drawing uniform cell placeholders", () => {
    const { container, rerender } = render(<Table aria-label="Orders" columnWidths={[120,160]} loading loadingLabel="Loading orders">
      <TableHeader><TableRow><TableHead>Market</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
      <TableBody><TableSkeletonRows columns={2} rows={2} /></TableBody>
    </Table>);
    expect(screen.getByRole("table", { name: "Orders" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("columnheader", { name: "Market" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading orders");
    expect(container.querySelectorAll("[skullet-bar]")).toHaveLength(4);
    expect(container.querySelector("tbody > div, tr > div")).toBeNull();
    expect(container.querySelector("col")).toHaveStyle({ width: "120px" });
    rerender(<Table aria-label="Orders" columnWidths={[120,160]}><TableBody><TableRow><TableCell>NEAR</TableCell><TableCell>25</TableCell></TableRow></TableBody></Table>);
    expect(container.querySelector("col")).toHaveStyle({ width: "120px" });
    expect(container.querySelector("[skullet-bar]")).toBeNull();
    expect(screen.getByRole("cell", { name: "25" })).toBeVisible();
  });

  it("can return to loading after revealing content", async () => {
    const { container, rerender } = render(<Skeleton loading label="Loading balance"><span>1000</span></Skeleton>);
    await act(async () => { rerender(<Skeleton loading={false} label="Loading balance"><span>1250</span></Skeleton>); });
    expect(container.querySelector("[skullet-reveal]")).not.toHaveAttribute("aria-busy");
    rerender(<Skeleton loading label="Loading balance"><span>1250</span></Skeleton>);
    expect(container.querySelector("[skullet-reveal]")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(screen.queryByText("1250", { selector: ":not([aria-hidden] *)" })).toBeNull());
  });

  it("does not persist financial content or metadata in remembered shapes", () => {
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(32);
    const store = vi.spyOn(Storage.prototype, "setItem");
    try {
      render(<Skeleton><span title="1234.56 private balance">1234.56 USDC</span></Skeleton>);
      expect(store.mock.calls.some(([key]) => key === "skullet:shapes")).toBe(false);
    } finally { height.mockRestore(); store.mockRestore(); }
  });

  it("server-renders hidden samples and the stylesheet without browser APIs", () => {
    const html = renderToString(<Skeleton loading label="Loading balance"><span>1000 USDC</span></Skeleton>);
    expect(html).toContain('skullet-loading=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('href="skullet"');
    expect(html).toContain('Loading balance');
  });
});
