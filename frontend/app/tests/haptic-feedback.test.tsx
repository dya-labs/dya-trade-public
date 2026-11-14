import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
const { trigger } = vi.hoisted(() => ({ trigger: vi.fn(() => Promise.resolve()) }));
vi.mock("web-haptics/react", () => ({ useWebHaptics: () => ({ trigger }) }));
function Selection() { const feedback = useHapticFeedback(); return <button onClick={() => feedback()}>Select</button>; }
it("requests one selection pulse only on mobile coarse-pointer devices without reduced motion", () => {
  let mobile = true;
  let reduced = false;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") ? reduced : mobile }));
  try {
    render(<Selection/>);
    fireEvent.click(screen.getByRole("button"));
    expect(trigger).toHaveBeenCalledExactlyOnceWith("selection");
    mobile = false;
    fireEvent.click(screen.getByRole("button"));
    mobile = true; reduced = true;
    fireEvent.click(screen.getByRole("button"));
    expect(trigger).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
