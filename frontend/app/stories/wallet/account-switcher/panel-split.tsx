import { AccountPanel } from "./panel";
import type { VariantProps } from "./model";
export function PanelSplit(props: VariantProps) { return <AccountPanel {...props} triggerTreatment="split" />; }
