"use client";
import { ExternalLink } from "@dya/ui/icons";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { transactionExplorerUrl } from "@/lib/near/domain/explorer";

export function ActivityTransactions({ hashes, network, label = "Transaction" }: { hashes?: string[]; network: string; label?: string }) {
  return <>{[...new Set(hashes ?? [])].filter(hash => hash.length > 0 && hash.length <= 128).map(hash => {
    const url = transactionExplorerUrl(network, hash);
    const short = hash.length > 22 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
    return <ActivityDetailRow key={hash} label={label}>{url
      ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" title={hash} aria-label={`${label}: ${hash}, view on explorer`}>{short}<ExternalLink className="size-3" aria-hidden="true" /></a>
      : <span className="break-all font-mono text-xs" title={hash}>{hash}</span>}</ActivityDetailRow>;
  })}</>;
}
