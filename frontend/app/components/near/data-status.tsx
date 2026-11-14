"use client";
import { Button } from "@dya/ui/components/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@dya/ui/components/popover";
export type FeedState = "Live" | "Delayed" | "Unavailable" | "Checking";
export type FeedHealth = { name: string; state: FeedState; essential?: boolean };
export function feedState(pending: boolean, available: boolean, failed: boolean, fresh = true): FeedState {
  if (available) return failed || !fresh ? "Delayed" : "Live";
  return pending ? "Checking" : "Unavailable";
}
/** Red only when an essential feed is down; otherwise name what is affected, in the theme warning color. */
export function overallHealth(feeds: FeedHealth[]) {
  if (feeds.some(f => f.essential && f.state === "Unavailable")) return { label: "Data services unavailable", color: "bg-destructive" };
  const unavailable = feeds.filter(f => f.state === "Unavailable");
  if (unavailable.length) return { label: unavailable.length === 1 ? `${unavailable[0]!.name} unavailable` : "Some services unavailable", color: "bg-warning" };
  if (feeds.some(f => f.state === "Delayed")) return { label: "Some data delayed", color: "bg-warning" };
  if (feeds.some(f => f.state === "Checking")) return { label: "Checking data", color: "bg-muted-foreground" };
  return { label: "Online", color: "bg-primary" };
}
export function DataStatus({ feeds }: { feeds: FeedHealth[] }) {
  const health = overallHealth(feeds);
  return <Popover>
    <PopoverTrigger render={<Button variant="ghost" size="xs" aria-label={`Data status: ${health.label}`} />}>
      <span aria-hidden="true" className={`size-2 rounded-full ${health.color}`} />
      <span role="status" aria-live="polite">{health.label}</span>
    </PopoverTrigger>
    <PopoverContent side="top" align="end"><PopoverTitle>Data status</PopoverTitle>
      <dl className="space-y-2">{feeds.map(feed => <div key={feed.name} className="flex items-center justify-between gap-4"><dt>{feed.name}</dt><dd className="text-muted-foreground">{feed.state}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Trade quotes are checked when requested.</p>
    </PopoverContent>
  </Popover>;
}
