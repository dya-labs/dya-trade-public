import type { ThemeInput } from "@luxalgo/vela";

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (channels: number[]) => `#${channels.map(channel => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;

/** The chart's typeface: the system UI stack the TradingView chart used, so text keeps its look. */
export const CHART_FONT = "-apple-system, BlinkMacSystemFont, \"Trebuchet MS\", Roboto, Ubuntu, sans-serif";

/**
 * A browser-resolved CSS color (`#rrggbb`, `rgb()`, `rgba()` or `color(srgb …)`) as opaque
 * `#rrggbb`, a translucent one composited over `base`; undefined when unreadable.
 */
export function opaqueColor(resolved: string, base: string): string | undefined {
  const value = resolved.trim().toLowerCase();
  if (HEX.test(value)) return value;
  const srgb = /^color\(srgb\s+([^)]*)\)$/.exec(value), rgb = /^rgba?\(([^)]*)\)$/.exec(value);
  const parts = (srgb ?? rgb)?.[1]?.split(/[\s,/]+/).filter(Boolean).map(part => part.endsWith("%") ? Number(part.slice(0, -1)) / 100 : Number(part));
  if (!parts || parts.length < 3 || parts.some(part => !Number.isFinite(part)) || !HEX.test(base)) return undefined;
  const scale = srgb ? 255 : 1, alpha = parts[3] ?? 1;
  const under = [1, 3, 5].map(offset => parseInt(base.slice(offset, offset + 2), 16));
  return hex(parts.slice(0, 3).map((channel, index) => channel * scale * alpha + under[index]! * (1 - alpha)));
}

/**
 * Theme tokens of `element` as opaque `#rrggbb`, as Vela derives its colors from them. Browsers may
 * return a token unresolved: Safari keeps `--border` as `color-mix(in srgb, #e8f0ed 4%, transparent)`,
 * which made the old chart's tooltip background transparent. Such a token is resolved by the
 * browser through a probe element and composited over `--card`; an unreadable one is returned as is.
 */
export function themeTokens(element: HTMLElement): (name: string) => string {
  const style = getComputedStyle(element);
  const raw = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const card = raw("card"), resolved = new Map<string, string>();
  return name => {
    let value = resolved.get(name);
    if (value === undefined) {
      value = raw(name);
      if (value && !HEX.test(value)) {
        const probe = element.ownerDocument.createElement("span");
        probe.style.color = value;
        element.ownerDocument.body.appendChild(probe);
        try { value = opaqueColor(String(getComputedStyle(probe).color ?? ""), card) ?? value; }
        finally { probe.remove(); }
      }
      resolved.set(name, value);
    }
    return value;
  };
}

/**
 * The chart theme from the app's tokens (`themeTokens`): the card surface, border grid, muted scale
 * text and the market colors, with Vela's menus and dialogs on the app's popover, accent and radii.
 */
export function chartThemeInput(token: (name: string) => string, dark: boolean): ThemeInput {
  return {
    base: dark ? "dark" : "light",
    colors: { background: token("card"), text: token("muted-foreground"), grid: token("border"), border: token("border"), up: token("market-up"), down: token("market-down"), accent: token("primary") },
    font: CHART_FONT,
    tokens: {
      fg: token("foreground"), "fg-bright": token("foreground"), "fg-muted": token("muted-foreground"),
      surface: token("card"), "surface-sunken": token("card"), "surface-elev": token("popover"), "surface-overlay": token("popover"),
      border: token("border"), "border-soft": token("border"), "border-strong": token("input"), scroll: token("border"),
      hover: token("accent"), active: token("accent"), "selected-bg": token("accent"), "selected-fg": token("foreground"),
      "fg-on-fill": token("primary-foreground"), danger: token("destructive"), loss: token("market-down"), profit: token("market-up"),
      "radius-sm": "var(--radius-sm)", "radius-md": "var(--radius-md)", "radius-lg": "var(--radius-lg)",
    },
  };
}
