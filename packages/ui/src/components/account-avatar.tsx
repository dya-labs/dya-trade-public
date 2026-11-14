"use client";

import { useId } from "react";
import { UserRound } from "@dya/ui/icons";
import { Avatar, AvatarFallback } from "@dya/ui/components/avatar";

// Curated theme pairs, shared with the app's chart palette.
const palettes = [
  ["var(--chart-1)", "var(--chart-2)"],
  ["var(--chart-2)", "var(--chart-5)"],
  ["var(--chart-5)", "var(--chart-3)"],
  ["var(--chart-3)", "var(--chart-4)"],
  ["var(--chart-4)", "var(--chart-5)"],
] as const;

// Normalize EVM addresses only; other account identifiers can be case-sensitive.
function avatarHash(seed: string) {
  const normalized = /^0x[0-9a-f]+$/i.test(seed) ? seed.toLowerCase() : seed;
  let hash = 2166136261;
  for (const character of normalized) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function AccountAvatar({ seed, size = "default", className }: { seed?: string | null; size?: "default" | "sm" | "lg"; className?: string }) {
  const gradientId = useId();
  const hash = seed ? avatarHash(seed) : 0;
  const [start, end] = palettes[(hash >>> 16) % palettes.length];
  const angle = hash % 360;
  const offset = 30 + ((hash >>> 8) % 41);
  return <Avatar size={size} className={className}>
    {seed ? <svg viewBox="0 0 32 32" className="size-full rounded-full" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1" gradientTransform={`rotate(${angle} .5 .5)`}>
        <stop stopColor={start} />
        <stop offset={`${offset}%`} stopColor={`color-mix(in oklch, ${start} 50%, ${end})`} />
        <stop offset="100%" stopColor={end} />
      </linearGradient></defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${gradientId})`} />
    </svg> : <AvatarFallback><UserRound className="size-4" aria-hidden="true" /></AvatarFallback>}
  </Avatar>;
}
