import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { OrderTicketLoading } from "@/components/near/ticket";

it("keeps trading controls visible and disabled while only the balance is skeletonized", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = render(<QueryClientProvider client={client}><OrderTicketLoading /></QueryClientProvider>);
  expect(screen.getByRole("tab", { name: "Market" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Buy" })).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByLabelText("Size")).toBeVisible();
  expect(screen.getByLabelText("Size")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  expect(screen.getByText("Order value")).toBeVisible();
  expect(screen.getByText("Fees")).toBeVisible();
  expect(container.querySelectorAll("[skullet-loading]")).toHaveLength(1);
  expect(container.querySelector("[skullet-loading] button")).toBeNull();
  unmount();
  client.clear();
});
