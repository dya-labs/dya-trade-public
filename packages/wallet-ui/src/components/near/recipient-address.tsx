"use client";

import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@dya/ui/icons";
import { Button } from "@dya/ui/components/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@dya/ui/components/tooltip";
import { networkName } from "../../lib/near/domain/deposit-assets";
import { NetworkMark } from "./network-mark";

export function RecipientAddress({ address, network, networkLabel, onCopyError }: {
  address: string;
  network?: string;
  networkLabel?: string;
  onCopyError: (message: string) => void;
}) {
  const feedback = useHapticFeedback();
  const [copiedAddress, setCopiedAddress] = useState<{ address: string } | null>(null);
  const copied = copiedAddress?.address === address;
  const latestAttempt = useRef(0);
  useEffect(() => {
    if (copiedAddress === null) return;
    const timer = setTimeout(() => setCopiedAddress(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedAddress]);
  async function copy() {
    const attempt = ++latestAttempt.current;
    try {
      await navigator.clipboard.writeText(address);
      if (attempt !== latestAttempt.current) return;
      feedback("light"); setCopiedAddress({ address });
      onCopyError("");
    } catch {
      if (attempt !== latestAttempt.current) return;
      setCopiedAddress(null);
      onCopyError("Unable to copy address. Please copy it manually.");
    }
  }
  const midpoint = Math.ceil(address.length / 2);
  return <div className="flex items-center gap-2">
    <Button variant="outline" className="h-auto! min-w-0 flex-1 justify-start gap-2 py-3 text-left" aria-label={copied ? "Address copied" : "Copy recipient address"} onClick={() => void copy()}>
      {network && <Tooltip>
        <TooltipTrigger render={<span />} className="flex size-6 shrink-0 items-center justify-center">
          <NetworkMark network={network} size={24} />
        </TooltipTrigger>
        <TooltipContent>{networkLabel ?? networkName(network)}</TooltipContent>
      </Tooltip>}
      <p className="min-w-0 flex-1 break-all whitespace-normal font-mono text-xs tabular-nums" title={address}>
        <span className="block">{address.slice(0, midpoint)}</span>
        <span className="block">{address.slice(midpoint)}</span>
      </p>
      {copied ? <Check className="shrink-0" aria-hidden="true" /> : <Copy className="shrink-0" aria-hidden="true" />}
    </Button>
  </div>;
}
