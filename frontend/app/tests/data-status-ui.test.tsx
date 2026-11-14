import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DataStatus, type FeedHealth } from "@/components/near/data-status";
afterEach(cleanup);
it("exposes each feed state and updates the status through outage and recovery", async () => {
  const initial: FeedHealth[] = [{ name: "Account service", essential: true, state: "Live" }, { name: "Token catalog", essential: true, state: "Checking" }, { name: "Exchange", state: "Live" }, { name: "Global metrics", state: "Delayed" }];
  const view = render(<DataStatus feeds={initial} />);
  fireEvent.click(screen.getByRole("button", { name: "Data status: Some data delayed" }));
  expect(await screen.findByText("Token catalog")).toBeInTheDocument();
  expect(screen.getByText("Checking")).toBeInTheDocument();
  expect(screen.getByText("Delayed")).toBeInTheDocument();
  expect(screen.getByText("Trade quotes are checked when requested.")).toBeInTheDocument();
  view.rerender(<DataStatus feeds={initial.map(feed => feed.name === "Token catalog" ? { ...feed, state: "Unavailable" } : feed)} />);
  expect(screen.getByRole("button", { name: "Data status: Data services unavailable" })).toBeInTheDocument();
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  view.rerender(<DataStatus feeds={initial.map(feed => ({ ...feed, state: "Live" }))} />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Online"));
  expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  expect(screen.queryByText("Delayed")).not.toBeInTheDocument();
});
it("shows checking until the first results arrive and names an optional outage without the essential-outage alarm", () => {
  const view = render(<DataStatus feeds={[{ name: "Account service", essential: true, state: "Checking" }]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking data");
  view.rerender(<DataStatus feeds={[{ name: "Account service", essential: true, state: "Live" }, { name: "Trading", state: "Unavailable" }, { name: "Prices", state: "Live" }]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Trading unavailable");
  expect(screen.queryByText("Data services unavailable")).not.toBeInTheDocument();
  view.rerender(<DataStatus feeds={[{ name: "Account service", essential: true, state: "Live" }, { name: "Trading", state: "Unavailable" }, { name: "Market overview", state: "Unavailable" }]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Some services unavailable");
});
