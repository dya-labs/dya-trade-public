"use client";
import { ExternalLink } from "@dya/ui/icons";
import { ActivityDetailRow } from "@dya/ui/components/activity-detail";
import { addressExplorerUrl } from "@/lib/near/domain/explorer";

export function TransferAddress({ label, address, network }: { label: string; address?: string; network: string }) {
  if (!address?.trim()) return null;
  const url = addressExplorerUrl(network, address);
  const short = address && address.length > 20 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
  return <ActivityDetailRow label={label}>{url
    ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={url} target="_blank" rel="noopener noreferrer" title={address} aria-label={`${label}: ${address}, view on explorer`}>{short}<ExternalLink className="size-3" aria-hidden="true" /></a>
    : <span className="break-all font-mono text-xs" title={address}>{address}</span>}</ActivityDetailRow>;
}
