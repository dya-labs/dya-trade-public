import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeedbackDialog } from "../components/near/feedback-dialog";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@dya/wallet-ui/lib/near/http/request", () => ({ request: mocks.request }));
afterEach(() => { cleanup(); mocks.request.mockReset(); });
function open(accountId: string | null = "user") {
  render(<FeedbackDialog accountId={accountId} />);
  fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
  return screen.getByRole("textbox", { name: "Feedback" });
}
it("confirms only after the service accepts the feedback", async () => {
  mocks.request.mockResolvedValue({ ok: true });
  const message = open();
  fireEvent.change(message, { target: { value: "Improve chart controls." } });
  fireEvent.submit(message.closest("form")!);
  expect(await screen.findByText("Feedback sent")).toBeVisible();
  expect(mocks.request).toHaveBeenCalledWith("feedback", expect.anything(), { id: expect.any(String), message: "Improve chart controls." });
});
it("retains the draft and request ID for retries after a failure", async () => {
  mocks.request.mockRejectedValueOnce(new Error("Feedback unavailable")).mockResolvedValueOnce({ ok: true });
  const message = open();
  fireEvent.change(message, { target: { value: "Please fix this." } });
  fireEvent.submit(message.closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Feedback unavailable");
  expect(message).toHaveValue("Please fix this.");
  fireEvent.submit(message.closest("form")!);
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request.mock.calls[0][2]).toEqual(mocks.request.mock.calls[1][2]);
});
it("requires sign-in without pretending feedback was sent", () => {
  expect(open(null)).toBeDisabled();
  expect(screen.getByText("Sign in to send feedback.")).toBeVisible();
  expect(mocks.request).not.toHaveBeenCalled();
});
