import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SlippageSettings } from "@/components/near/slippage-settings";
afterEach(cleanup);
it("prefills 0.3%, validates percentages, and saves integer bps", () => {
  const onChange = vi.fn();
  render(<SlippageSettings value={{ mode: "default" }} disabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Adjust max slippage" }));
  const input = screen.getByLabelText("Max");
  for (const value of ["", "0", "5.01", "0.001", "-1", "1e2"]) {
    fireEvent.change(input, { target: { value } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  }
  fireEvent.change(input, { target: { value: "0.29" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onChange).toHaveBeenCalledWith({ mode: "custom", bps: 29 });
});
it("discarding an edit preserves the saved preference", () => {
  const onChange = vi.fn();
  render(<SlippageSettings value={{ mode: "custom", bps: 25 }} disabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Adjust max slippage" }));
  fireEvent.change(screen.getByLabelText("Max"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onChange).not.toHaveBeenCalled();
});

it("shows only the percentage and prefills the fixed 0.3% starting value", () => {
  const onChange = vi.fn();
  render(<SlippageSettings value={{ mode: "default" }} disabled={false} onChange={onChange} />);
  expect(screen.getByRole("button", { name: "Adjust max slippage" })).toHaveTextContent("0.3%");
  fireEvent.click(screen.getByRole("button", { name: "Adjust max slippage" }));
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Max")).toHaveValue("0.3");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onChange).toHaveBeenCalledWith({ mode: "custom", bps: 30 });
});
