// Everything the chart needs from Vela, loaded on demand: the library is too large for the
// Terminal's first paint. Importing this module registers the Terminal's natives and buttons.
import { checkTheme, createTheme, type UiTheme } from "@luxalgo/vela";
import { registerNativeIndicator, registerRendererLayer, registerWidgetAction } from "@luxalgo/vela/plugin";
import { chartThemeInput } from "@/lib/chart-theme";
import { intentsOverlayIndicator, intentsOverlayLayer, intentsToggleActions } from "@/lib/market-data/intents-overlay";
import { chartLinesIndicator } from "./chart-lines";

export { Tooltip } from "@luxalgo/vela/ui";
export { VelaWorkspace } from "@luxalgo/vela/workspace";
export { createReferenceProvider } from "@/lib/market-data/reference-provider";

registerNativeIndicator(intentsOverlayIndicator);
registerRendererLayer(intentsOverlayLayer);
for (const action of intentsToggleActions) registerWidgetAction(action);
registerNativeIndicator(chartLinesIndicator);

/** The app's theme built for Vela; its problems are logged rather than hidden. */
export function createChartTheme(token: (name: string) => string, dark: boolean): UiTheme {
  const input = chartThemeInput(token, dark);
  const problems = checkTheme(input);
  if (problems.length) console.warn("Chart theme", problems);
  return createTheme(input);
}
