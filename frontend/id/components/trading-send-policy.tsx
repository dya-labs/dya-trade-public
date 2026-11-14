"use client";

import { useState, type ReactNode } from "react";
import { AssetMark } from "@dya/wallet-ui/components/near/asset-mark";
import { WalletActivityList } from "@dya/wallet-ui/components/wallet-activity";
import { WalletActivityRow } from "@dya/wallet-ui/components/wallet-activity-row";
import { WalletSectionContent } from "@dya/wallet-ui/components/wallet-section";
import { CenteredHeading } from "@dya/ui/components/centered-heading";
import { ToastTransitionIcon } from "@dya/ui/components/toast-transition";
import { OverlayHeader } from "@dya/ui/components/overlay-header";
import { Input } from "@dya/ui/components/input";
import { TokenChoiceRow } from "@dya/wallet-ui/components/token-choice-row";
import { useCatalogQuery } from "@dya/wallet-ui/hooks/use-wallet-queries";
import { networkName } from "@dya/wallet-contracts/src/domain/deposit-assets";
import { tokenAllowed } from "@dya/wallet-contracts/src/domain/token-registry";
import { networkAllowed } from "@dya/wallet-contracts/src/domain/networks";
import { Switch } from "@dya/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startAuthentication } from "@simplewebauthn/browser";
import { Button } from "@dya/ui/components/button";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { approveSendPolicyVote, fileSendPolicy, prepareSendPolicyFiling, prepareSendPolicyVote, readSendPolicy, resendSendPolicyFiling } from "../lib/outlayer-client";

export function TradingSendPolicy({ walletId, onBusyChange, children, settings = false }: { walletId: string; onBusyChange: (busy: boolean) => void; children?: ReactNode; settings?: boolean }) {
  const client = useQueryClient();
  const queryKey = ["id", "trading-send-policy", walletId] as const;
  const policy = useQuery({
    queryKey,
    queryFn: () => readSendPolicy(walletId),
    refetchIntervalInBackground: true,
    refetchInterval: query => query.state.data?.phase === "submitted" ? 3000 : false,
  });
  const phase = policy.data?.phase;
  const [edit, setEdit] = useState<{ phase: "draft" | "review"; enabled: boolean; trading?: boolean; excludeTradeApproval?: true; unlockedTradingTest?: true }>();
  const enabled = policy.data?.sendEnabled ?? (phase === "confirmed");
  const catalog = useCatalogQuery(settings).data;
  const [draftAssets, setDraftAssets] = useState<string[]>();
  const [search, setSearch] = useState<string>();
  const activeAssets = policy.data?.allowedAssets ?? [];
  const assetChanges = policy.data?.pendingAssets ?? draftAssets;
  const displayedAssets = assetChanges ?? activeAssets;
  const describe = (id: string) => {
    const token = catalog?.assets.find(item => item.assetId === id);
    return token ? `${token.symbol} · ${networkName(token.blockchain)}` : id;
  };
  function stageAssets(ids: string[]) {
    const changed = ids.length !== activeAssets.length || ids.some(id => !activeAssets.includes(id));
    setDraftAssets(changed ? ids : undefined);
    setEdit(changed ? { phase: "draft", enabled: true } : undefined);
    setSearch(undefined);
  }
  const unlocked = policy.data?.unlockedTradingTest === true;
  const unlockedTradingTest = policy.data?.pendingUnlockedTradingTest || edit?.unlockedTradingTest;
  const excludeTradeApproval = policy.data?.pendingTradeApprovalExclusions || edit?.excludeTradeApproval;
  const tradingChange = policy.data?.pendingTradingEnabled ?? edit?.trading;
  const pending = policy.data?.pendingEnabled;
  const reviewing = settings && (pending !== undefined || edit?.phase === "review");
  const target = pending ?? edit?.enabled ?? true;
  const approve = useMutation({
    mutationFn: async () => {
      onBusyChange(true);
      try {
        if (phase === "submitted") {
          await resendSendPolicyFiling(walletId);
        } else if (phase === "voted") {
          const filing = await prepareSendPolicyFiling(walletId);
          if ("options" in filing) {
            const result = await fileSendPolicy(walletId, await startAuthentication({ optionsJSON: filing.options }));
            if (result.phase === "submitted") {
              await client.cancelQueries({ queryKey, exact: true });
              client.setQueryData<Awaited<ReturnType<typeof readSendPolicy>>>(queryKey,
                previous => ({ ...previous, phase: "submitted" }));
              setEdit(undefined);
              setDraftAssets(undefined);
            }
          }
        } else {
          const prepared = await prepareSendPolicyVote(walletId, !unlocked && tradingChange === undefined && !excludeTradeApproval && !unlockedTradingTest ? target : undefined, assetChanges, tradingChange, excludeTradeApproval || undefined, unlockedTradingTest || undefined);
          if ("options" in prepared) await approveSendPolicyVote(walletId, await startAuthentication({ optionsJSON: prepared.options }));
        }
      } finally {
        const updated = await policy.refetch();
        if (updated.data?.pendingEnabled !== undefined || (!excludeTradeApproval && tradingChange === undefined && !assetChanges && updated.data?.sendEnabled === target)) setEdit(undefined);
        if (updated.data?.pendingEnabled !== undefined) setDraftAssets(undefined);
        onBusyChange(false);
      }
    },
  });

  if (policy.isPending) return <p role="status">Checking Send policy…</p>;
  if (policy.isError && phase !== "submitted") return <Button variant="outline" onClick={() => void policy.refetch()}>Retry policy check</Button>;
  if (unlocked && !settings) return <p role="status">Trading test policy active. Withdrawals are disabled.</p>;
  if (!settings && pending === false) return <Button variant="outline" render={<a href="/policy" />}>View pending Send policy change</Button>;
  if (phase === "submitted") return <section className="space-y-4">
    <CenteredHeading
      icon={<ToastTransitionIcon size="lg" complete={false} />}
      title={<span role="status">Waiting for on-chain confirmation…</span>}
    />
    {approve.error && <Alert variant="destructive"><AlertDescription>{approve.error.message}</AlertDescription></Alert>}
    <Button variant="outline" className="w-full" disabled={approve.isPending} onClick={() => approve.mutate()}>
      {approve.isPending ? "Resending…" : "Resend signed transaction"}
    </Button>
  </section>;
  if (!settings && phase === "confirmed") return <>{children}</>;
  return <section className="space-y-4">
    {settings && !reviewing && <section aria-label="Send policy" className="divide-y divide-border rounded-lg border text-sm">
      {unlocked ? <p className="p-4 text-muted-foreground">Withdrawals are disabled.</p> : <>
      <div className="flex items-center justify-between gap-4 p-4">
        <div><label htmlFor="send-policy-toggle">Send</label><p className="text-muted-foreground">{enabled ? "Enabled" : "Disabled"} on-chain</p></div>
        <Switch id="send-policy-toggle" checked={pending ?? edit?.enabled ?? enabled}
          disabled={!!excludeTradeApproval || tradingChange !== undefined || !!assetChanges || pending !== undefined || edit?.phase === "review" || approve.isPending}
          onCheckedChange={checked => { setDraftAssets(undefined); setEdit(checked === enabled ? undefined : { phase: "draft", enabled: checked }); }} />
      </div>
      <div className="flex items-center justify-between gap-4 p-4">
        <div><label htmlFor="trading-policy-toggle">Swaps and limit orders</label><p className="text-muted-foreground">Request trading without per-order approval</p></div>
        <Switch id="trading-policy-toggle" checked={tradingChange ?? policy.data?.tradingEnabled ?? false}
          disabled={pending !== undefined || approve.isPending || (!!edit && edit.trading === undefined)}
          onCheckedChange={checked => setEdit(checked === (policy.data?.tradingEnabled ?? false) ? undefined : { phase: "draft", enabled, trading: checked })} />
      </div>
      {policy.data?.canUnlockTradingTest && !edit &&
        <div className="p-4"><Button variant="outline" onClick={() => setEdit({ phase: "review", enabled: false, unlockedTradingTest: true })}>Review unlocked trading test</Button></div>}
      {policy.data?.tradingEnabled && !policy.data.tradeApprovalExclusions && !edit &&
        <div className="p-4"><Button variant="outline" onClick={() => setEdit({ phase: "review", enabled, excludeTradeApproval: true })}>Exclude swaps and limit orders from approval</Button></div>}
      </>}
      {(enabled || unlocked) && <div className="space-y-2 p-4">
        <h2>Allowed assets</h2>
        {displayedAssets.length > 0 && <WalletSectionContent><WalletActivityList>
          {displayedAssets.map(id => {
            const asset = catalog?.assets.find(item => item.assetId === id);
            return <WalletActivityRow key={id} className="px-3"
              icon={asset && <AssetMark asset={asset} network={asset.blockchain} size={36} />}
              title={asset?.symbol ?? <span className="break-all">{id}</span>}
              subtitle={asset && networkName(asset.blockchain)}
              amount={<Button variant="ghost" size="sm" disabled={!!excludeTradeApproval || tradingChange !== undefined || pending !== undefined || edit?.phase === "review" || approve.isPending}
                aria-label={`Remove ${describe(id)}`} onClick={() => stageAssets(displayedAssets.filter(assetId => assetId !== id))}>Remove</Button>} />;
          })}
        </WalletActivityList></WalletSectionContent>}
        {search === undefined ? <Button variant="outline" disabled={!!excludeTradeApproval || tradingChange !== undefined || pending !== undefined || edit?.phase === "review" || approve.isPending}
          onClick={() => setSearch("")}>Add asset</Button> : <>
          <Input autoFocus aria-label="Search tokens and networks" placeholder="Search tokens and networks" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="max-h-80 overflow-y-auto">
            {catalog?.assets.filter(asset => !displayedAssets.includes(asset.assetId) &&
              tokenAllowed(asset, catalog.tokens?.find(token => token.id === asset.assetId), unlocked ? "trading" : "withdrawals") &&
              (unlocked || networkAllowed(catalog.networks?.find(network => network.id === asset.blockchain), "withdrawals")) &&
              describe(asset.assetId).toLowerCase().includes(search.trim().toLowerCase()))
              .map(asset => <TokenChoiceRow key={asset.assetId} asset={asset} label={describe(asset.assetId)} selected={false}
                onSelect={() => stageAssets([...displayedAssets, asset.assetId])} />)}
          </div>
          <Button variant="ghost" onClick={() => setSearch(undefined)}>Cancel</Button>
        </> }
      </div>}
    </section>}
    {settings && pending === undefined && edit?.phase === "draft" &&
      <Button className="w-full" onClick={() => setEdit({ ...edit, phase: "review" })}>Review changes</Button>}
    {reviewing && <section className="space-y-3" aria-label="Review policy changes">
      <OverlayHeader backLabel="Edit changes" backDisabled={approve.isPending}
        onBack={pending === undefined ? () => setEdit(unlockedTradingTest || excludeTradeApproval ? undefined : { phase: "draft", enabled: target, trading: tradingChange }) : undefined}>
        <h2>{unlockedTradingTest ? "Review unlocked trading test" : excludeTradeApproval ? "Exclude swaps and limit orders from approval" : tradingChange !== undefined ? (tradingChange ? "Enable swaps and limit orders" : "Disable swaps and limit orders") : assetChanges ? "Review allowed assets" : target ? "Enable Send" : "Disable Send"}</h2>
      </OverlayHeader>
      {unlockedTradingTest ? <p className="text-sm text-muted-foreground">Remove the 1-of-1 approval threshold and policy lock, and turn off withdrawals. Future policy changes will no longer require the current 1-of-1 vote.</p> : (excludeTradeApproval || tradingChange !== undefined) ? <p className="text-sm text-muted-foreground">Withdrawals and policy changes keep their existing approval requirements.</p> : assetChanges ? <WalletSectionContent><WalletActivityList>
        {[...assetChanges.filter(id => !activeAssets.includes(id)), ...activeAssets.filter(id => !assetChanges.includes(id))].map(id => {
          const asset = catalog?.assets.find(item => item.assetId === id);
          return <WalletActivityRow key={id} className="px-3"
            icon={asset && <AssetMark asset={asset} network={asset.blockchain} size={36} />}
            title={asset?.symbol ?? <span className="break-all">{id}</span>}
            subtitle={asset && networkName(asset.blockchain)}
            amount={assetChanges.includes(id) ? "Add" : "Remove"} />;
        })}
      </WalletActivityList></WalletSectionContent> :
        <p className="text-sm text-muted-foreground">{target ? "Allow withdrawals with passkey approval." : "Block new withdrawals from this Trading account."}</p>}
    </section>}
    {approve.error && <Alert variant="destructive"><AlertDescription>{approve.error.message}</AlertDescription></Alert>}
    {(!settings || pending !== undefined || edit?.phase === "review") && <Button className="w-full" disabled={approve.isPending} onClick={() => approve.mutate()}>
      {approve.isPending ? "Waiting for confirmation…" : phase === "voted" ? "Confirm policy update" : "Approve with passkey"}
    </Button>}
  </section>;
}
