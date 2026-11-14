import { describe, expect, it } from "vitest";
import { checkTheme, createTheme } from "@luxalgo/vela";
import { chartThemeInput, opaqueColor } from "./chart-theme";

// The Terminal's resolved tokens (packages/ui/src/styles/tokens.css), dark and light.
const dark: Record<string, string> = {
  foreground: "#e8f0ed", card: "#111312", popover: "#1b1e1c", primary: "#34d399", "primary-foreground": "#061b12",
  "muted-foreground": "#9fafa9", accent: "#15251d", destructive: "#fb7185", border: "#1a1c1b", input: "#2c4437",
  "market-up": "#34d399", "market-down": "#fb7185",
};
const light: Record<string, string> = {
  foreground: "#182d23", card: "#ffffff", popover: "#ffffff", primary: "#087f5b", "primary-foreground": "#ffffff",
  "muted-foreground": "#536e60", accent: "#d8ecdf", destructive: "#be3154", border: "#cadcd1", input: "#cadcd1",
  "market-up": "#087f5b", "market-down": "#be3154",
};

describe("Vela chart theme", () => {
  it.each([["dark", dark, true], ["light", light, false]] as const)("builds a valid %s theme from the app's tokens", (_name, tokens, isDark) => {
    const input = chartThemeInput(name => tokens[name] ?? "", isDark);
    expect(checkTheme(input)).toEqual([]);
    const theme = createTheme(input);
    expect(theme.chart).toMatchObject({ background: tokens.card, textColor: tokens["muted-foreground"], upColor: tokens["market-up"], downColor: tokens["market-down"] });
    expect(theme.tokens).toMatchObject({ "--vela-surface-elev": tokens.popover, "--vela-hover": tokens.accent, "--vela-accent": tokens.primary });
  });

  it("reads updated theme tokens rather than retaining the previous theme", () => {
    const current = { ...dark };
    const before = createTheme(chartThemeInput(name => current[name] ?? "", true));
    current["market-up"] = "#5ad7cc";
    const after = createTheme(chartThemeInput(name => current[name] ?? "", true));
    expect(after.id).not.toBe(before.id);
    expect(after.chart.upColor).toBe("#5ad7cc");
  });
});

describe("opaque theme colors", () => {
  // Safari leaves `--border` as `color-mix(in srgb, #e8f0ed 4%, transparent)`; browsers resolve it to these forms.
  it("composite translucent browser colors over the card", () => {
    expect(opaqueColor("color(srgb 0.909804 0.941176 0.929412 / 0.04)", "#111312")).toBe("#1a1c1b");
    expect(opaqueColor("rgba(232, 240, 237, 0.04)", "#111312")).toBe("#1a1c1b");
    expect(opaqueColor("rgb(232 240 237 / 4%)", "#111312")).toBe("#1a1c1b");
    expect(opaqueColor("rgb(52, 211, 153)", "#111312")).toBe("#34d399");
    expect(opaqueColor("#34D399", "#111312")).toBe("#34d399");
  });

  it("report unreadable colors instead of inventing one", () => {
    expect(opaqueColor("color-mix(in srgb, #e8f0ed 4%, transparent)", "#111312")).toBeUndefined();
    expect(opaqueColor("", "#111312")).toBeUndefined();
  });
});
