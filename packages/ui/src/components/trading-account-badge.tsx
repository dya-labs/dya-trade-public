import { Badge } from "./badge";

export function TradingAccountBadge() {
  return <Badge variant="secondary" className="size-4 shrink-0 justify-center rounded-sm bg-primary/15 p-0 text-primary" title="Trading account"><span aria-hidden="true" className="size-1.5 rotate-45 bg-primary" /><span className="sr-only">Trading account</span></Badge>;
}
