"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function formatActivityTime(value: number, timeZone: string) {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) return null;
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return {
    iso: date.toISOString(),
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}`,
    zone: timeZone,
  };
}

export function ActivityTime({ value, updated = false }: { value: number; updated?: boolean }) {
  // Keep the server and first hydration render identical; only the browser knows its local timezone.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const formatted = mounted ? formatActivityTime(value, Intl.DateTimeFormat().resolvedOptions().timeZone) : null;
  if (!formatted) return <span title={mounted ? "Time unavailable" : "Loading local time"}>-</span>;
  return <time className="whitespace-nowrap tabular-nums" dateTime={formatted.iso} title={`${updated ? "Last updated: " : ""}${formatted.date} ${formatted.time} (${formatted.zone})\nUTC: ${formatted.iso}`}>
    {formatted.date} <span className="text-muted-foreground">{formatted.time}</span>{updated && <span className="sr-only"> (last updated)</span>}
  </time>;
}
