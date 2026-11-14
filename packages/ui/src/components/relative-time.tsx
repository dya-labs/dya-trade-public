"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@dya/ui/lib/format-relative-time";

export function RelativeTime({ timestamp, format = "relative" }: { timestamp: number; format?: "relative" | "full" | "date" | "time" }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (format !== "relative") return;
    const update = () => { if (!document.hidden) setNow(Date.now()); };
    update();
    const timer = setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [format]);
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return <span title="Time unavailable">-</span>;
  const text = format === "time" ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) : format === "date" ? date.toLocaleDateString() : format === "full" ? date.toLocaleString() : now !== null
    ? formatRelativeTime(timestamp, now)
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return <time dateTime={date.toISOString()} title={date.toLocaleString()}>{text}</time>;
}
