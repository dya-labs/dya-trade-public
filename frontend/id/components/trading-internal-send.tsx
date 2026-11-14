"use client";

import { ChevronRight } from "@dya/ui/icons";
import { TradingAccountBadge } from "@dya/ui/components/trading-account-badge";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
import { WalletActivityList } from "@dya/wallet-ui/components/wallet-activity";
import { WalletActivityRow } from "@dya/wallet-ui/components/wallet-activity-row";
import { WalletSectionContent } from "@dya/wallet-ui/components/wallet-section";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { startAuthentication } from "@simplewebauthn/browser";
import { prepareWithdrawal, submitWithdrawal, getWithdrawalStatus } from "@dya/wallet-ui/lib/near/http/transfers-client";
import { CenteredHeading } from "@dya/ui/components/centered-heading";
import { ToastTransitionIcon } from "@dya/ui/components/toast-transition";
import { Button } from "@dya/ui/components/button";
import { Input } from "@dya/ui/components/input";
import { DialogDrawerHeader } from "@dya/ui/components/dialog-drawer";
import { D } from "@dya/wallet-contracts/src/domain/decimal";
import { SendReview } from "@dya/wallet-ui/components/send-review";
import { AssetMark } from "@dya/wallet-ui/components/near/asset-mark";
import { SendAmount } from "@dya/wallet-ui/components/send-amount";
import { TokenChoiceRow } from "@dya/wallet-ui/components/token-choice-row";
import { networkName } from "@dya/wallet-contracts/src/domain/deposit-assets";
import { WalletTitle } from "@dya/wallet-ui/components/presentation";
import { approveTradingWithdrawal, prepareTradingWithdrawalApproval, readTradingWithdrawal, readTradingInternalAssets, reviewTradingInternalSend } from "../lib/outlayer-client";

type Asset = Awaited<ReturnType<typeof readTradingInternalAssets>>["assets"][number];

type Step =
  | { phase: "choose" }
  | { phase: "token"; destination: string; name: string; assets: Asset[]; reason?: "policy" | "asset" }
  | { phase: "amount"; destination: string; name: string; asset: Asset }
  | { phase: "review"; destination: string; name: string; amount: string; asset: Asset }
  | { phase: "status"; id: string }
  | { phase: "uncertain" };

export function TradingInternalSend({ walletId, accounts, onBusyChange, onUpdated, onDone, mainAssets, balances }: {
  walletId: string;
  mainAssets?: Asset[];
  balances: { assetId: string; amount: string; decimals: number }[];
  accounts: { id: string; name: string; avatarSeed?: string }[];
  onBusyChange: (busy: boolean) => void;
  onUpdated: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>({ phase: "choose" });
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const chooseAccount = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { assets, reason } = mainAssets ? { assets: mainAssets, reason: undefined } : await readTradingInternalAssets(walletId);
      return { destination: id, name, assets, reason };
    },
    onSuccess: ({ destination, name, assets, reason }) => {
      setAmount("");
      setSearch("");
      setStep(assets.length === 1
        ? { phase: "amount", destination, name, asset: assets[0] }
        : { phase: "token", destination, name, assets, reason });
    },
  });
  const send = useMutation({
    mutationFn: async (review: Extract<Step, { phase: "review" }>) => {
      onBusyChange(true);
      try {
        if (mainAssets) {
          const { options } = await prepareWithdrawal({
            wallet: "", internalAccountId: review.destination, amount: review.amount,
            originAssetId: review.asset.assetId, destinationAssetId: review.asset.assetId,
          });
          const assertion = await startAuthentication({ optionsJSON: options });
          setStep({ phase: "uncertain" });
          const { withdrawal } = await submitWithdrawal(assertion);
          setStep({ phase: "status", id: withdrawal.id });
          onUpdated();
          return;
        }
        const [whole, fraction = ""] = review.amount.split(".");
        const rawAmount = BigInt(whole + fraction.padEnd(review.asset.decimals, "0")).toString();
        const { id } = await reviewTradingInternalSend(walletId, review.destination, rawAmount, review.asset.assetId);
        const { options } = await prepareTradingWithdrawalApproval(walletId, id);
        const assertion = await startAuthentication({ optionsJSON: options });
        setStep({ phase: "status", id });
        await approveTradingWithdrawal(walletId, id, assertion);
      } finally {
        onBusyChange(false);
      }
    },
  });
  const transferId = step.phase === "status" ? step.id : undefined;
  const status = useQuery({
    queryKey: ["id", "internal-transfer", walletId, transferId],
    enabled: !!transferId && !send.isPending,
    queryFn: async () => {
      if (!transferId) throw new Error("Transfer unavailable");
      if (!mainAssets) return readTradingWithdrawal(walletId, transferId);
      const result = await getWithdrawalStatus(transferId);
      return { withdrawal: result.withdrawal, terminal: ["settled", "failed"].includes(result.withdrawal.state) };
    },
    retry: false,
    refetchInterval: query => query.state.data?.terminal || query.state.error ? false : 5000,
  });
  const terminal = status.data?.terminal;
  const refreshedTransfer = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!terminal || !transferId || refreshedTransfer.current === transferId) return;
    refreshedTransfer.current = transferId;
    onUpdated();
  }, [terminal, transferId, onUpdated]);
  if (step.phase === "status" || step.phase === "uncertain") {
    const complete = status.data?.withdrawal.state === "settled";
    const failed = status.data?.withdrawal.state === "failed";
    const needsReview = step.phase === "uncertain" || (terminal && !complete && !failed);
    const processing = !terminal && !status.isError && !needsReview;
    return <section className="space-y-4">
      <CenteredHeading
        icon={(processing || complete) && <ToastTransitionIcon size="lg" complete={complete} />}
        title={<span role="status">{complete ? "Transfer complete" : failed ? "Transfer failed" : needsReview ? "Transfer needs review" : status.isError ? "Unable to check transfer" : "Transfer processing"}</span>}
        description={needsReview ? "Check Activity before trying this transfer again." : undefined}
      />
      {complete && <Button className="w-full" onClick={onDone}>Done</Button>}
      {!complete && status.isError && <Button variant="outline" className="w-full" disabled={status.isFetching} onClick={() => void status.refetch()}>Retry status check</Button>}
    </section>;
  }
  const balance = step.phase === "amount" ? balances.find(item => item.assetId === step.asset.assetId) : undefined;
  const insufficient = !!balance && /^\d+(?:\.\d+)?$/.test(amount) && new D(amount).gt(balance.amount);
  const validAmount = !!balance && !insufficient && step.phase === "amount" && /^\d{1,12}(?:\.\d+)?$/.test(amount) &&
    (amount.split(".")[1]?.length ?? 0) <= step.asset.decimals && Number(amount) > 0;
  const filtered = step.phase === "token" ? step.assets.filter(asset =>
    `${asset.symbol} ${networkName(asset.blockchain)}`.toLowerCase().includes(search.trim().toLowerCase())) : [];
  return <section className="space-y-4">
    <DialogDrawerHeader onBack={step.phase === "review" ? () => { send.reset(); setStep({ ...step, phase: "amount" }); } : undefined} backLabel="Back to amount" backDisabled={send.isPending}><WalletTitle className={step.phase === "choose" ? "sr-only" : undefined}>{step.phase === "choose" ? "Choose an account" : step.phase === "token" ? "Choose a token" : step.phase === "amount" ? "Enter amount" : step.phase === "review" ? "Review transfer" : "Transfer status"}</WalletTitle></DialogDrawerHeader>
    {step.phase === "choose" && <WalletSectionContent><WalletActivityList>
      {accounts.filter(account => account.id !== walletId).map(account =>
        <WalletActivityRow key={account.id} title={<span className="flex items-center gap-2">{account.name}{account.id !== "main" && <TradingAccountBadge />}</span>} icon={<AccountAvatar seed={account.avatarSeed ?? account.id} size="sm" />} disabled={chooseAccount.isPending}
          amount={<ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />}
          onClick={() => chooseAccount.mutate(account)} />)}
    </WalletActivityList></WalletSectionContent>}
    {chooseAccount.isError && <p role="alert">Couldn’t check available tokens. Choose an account to retry.</p>}
    {step.phase === "token" && <>
      {step.assets.length === 0 && <p role="status">{step.reason === "policy" ? "Enable Send in Policy to transfer from this account." : step.reason === "asset" ? "There’s no balance available in the assets allowed by your Send policy." : "No tokens are available to send."}</p>}
      {step.assets.length > 0 && <Input autoFocus aria-label="Search tokens" placeholder="Search tokens" value={search} onChange={event => setSearch(event.target.value)} />}
      <div className="-mx-2 max-h-80 space-y-1 overflow-y-auto">
        {filtered.map(asset => <TokenChoiceRow key={asset.assetId} asset={asset}
          label={`${asset.symbol} · ${networkName(asset.blockchain)}`} selected={false}
          onSelect={() => setStep({ phase: "amount", destination: step.destination, name: step.name, asset })} />)}
        {step.assets.length > 0 && !filtered.length && <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">No matching tokens</p>}
      </div>
    </>}
    {step.phase === "amount" && <form className="space-y-4" onSubmit={event => {
      event.preventDefault();
      if (validAmount) setStep({ ...step, phase: "review", amount });
    }}>
      <SendAmount id="internal-send-amount" symbol={step.asset.symbol} amount={amount}
        balance={balance} insufficient={insufficient} onChange={setAmount} />
      <Button type="submit" className="w-full" disabled={!validAmount}>Review transfer</Button>
    </form>}
    {step.phase === "review" && <SendReview label="You send" amount={step.amount} symbol={step.asset.symbol}
      icon={<AssetMark asset={step.asset} size={36} />}
      recipient={<WalletSectionContent><WalletActivityRow className="px-3"
        icon={<AccountAvatar seed={accounts.find(account => account.id === step.destination)?.avatarSeed ?? step.destination} size="sm" />}
        title={<span className="flex items-center gap-2">{step.name}{step.destination !== "main" && <TradingAccountBadge />}</span>}
        subtitle="Destination account" /></WalletSectionContent>}>
      <Button className="w-full" disabled={send.isPending} onClick={() => send.mutate(step)}>{send.isPending ? "Preparing approval…" : "Confirm transfer"}</Button>
    </SendReview>}
    {send.isError && <p role="alert" className="text-sm text-destructive">Couldn’t prepare or approve this transfer.</p>}
  </section>;
}
