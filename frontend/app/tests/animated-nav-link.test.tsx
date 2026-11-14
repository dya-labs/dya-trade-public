import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { AnimatedNavLink } from "@dya/ui/components/animated-nav-link";

it("animates once per pointer click while keeping navigation immediate, and skips keyboard/reduced motion", () => {
  const animate = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const originalAnimate = Element.prototype.animate;
  const originalGetAnimations = Element.prototype.getAnimations;
  Element.prototype.animate = animate;
  Element.prototype.getAnimations = () => [];
  try {
    const clicked = vi.fn();
    render(<AnimatedNavLink icon="trade" href="#trade" onClick={clicked}>Trade</AnimatedNavLink>);
    const link = screen.getByRole("link", { name: "Trade" });
    fireEvent.click(link, { detail: 1 });
    expect(clicked).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 900, iterations: 1 });
    fireEvent.click(link, { detail: 1 });
    expect(animate).toHaveBeenCalledTimes(2);
    fireEvent.click(link, { detail: 0 });
    expect(animate).toHaveBeenCalledTimes(2);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    fireEvent.click(link, { detail: 1 });
    expect(animate).toHaveBeenCalledTimes(2);
  } finally {
    Element.prototype.animate = originalAnimate;
    Element.prototype.getAnimations = originalGetAnimations;
    vi.unstubAllGlobals();
  }
});


it("animates the mounted filled bars on the first Markets selection", () => {
  const targets: Element[] = [];
  const originalAnimate = Element.prototype.animate;
  const originalGetAnimations = Element.prototype.getAnimations;
  Element.prototype.animate = function () { targets.push(this); return {} as Animation; };
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  function Scenario() {
    const [active, setActive] = useState(false);
    return <AnimatedNavLink icon="markets" href="#markets" aria-current={active ? "page" : undefined} onClick={() => setActive(true)}>Markets</AnimatedNavLink>;
  }
  try {
    render(<Scenario/>);
    fireEvent.click(screen.getByRole("link", { name: "Markets" }), { detail: 1 });
    expect(targets).toHaveLength(3);
    expect(targets.every(target => target.isConnected && target.closest("mask"))).toBe(true);
  } finally {
    Element.prototype.animate = originalAnimate;
    Element.prototype.getAnimations = originalGetAnimations;
    vi.unstubAllGlobals();
  }
});
