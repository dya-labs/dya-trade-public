import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WalletReview } from "../../id/components/wallet-review";

it("hydrates limit expiry across different server and browser date formats", async () => {
  const orderExpires = "2026-10-19T15:40:00.000Z";
  const locale = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("server date format");
  const review = { title: "Fund limit order", details: { side: "buy", quantity: "1", asset: "NEAR", fundingAmount: "4", fundingAsset: "USDC", price: "4", quoteAsset: "USDC", orderExpires } };
  const container = document.createElement("div");
  container.innerHTML = renderToString(<WalletReview review={review} now={0} />);
  expect(container.textContent).toContain("2026-10-19 15:40:00 UTC");
  expect(locale).not.toHaveBeenCalled();
  locale.mockReturnValue("browser local date");
  document.body.appendChild(container);
  const recover = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, <WalletReview review={review} now={0} />, { onRecoverableError: recover }); });
    expect(recover).not.toHaveBeenCalled();
    expect(container.textContent).toContain("browser local date");
    expect(container.querySelector("time")?.dateTime).toBe(orderExpires);
  } finally {
    if (root) await act(async () => root!.unmount());
    container.remove(); locale.mockRestore();
  }
});
