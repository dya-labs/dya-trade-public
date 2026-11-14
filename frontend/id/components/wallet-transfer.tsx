"use client";

import { WalletActivityList } from "@dya/wallet-ui/components/wallet-activity";
import { WalletActivityRow } from "@dya/wallet-ui/components/wallet-activity-row";
import { WalletSectionContent } from "@dya/wallet-ui/components/wallet-section";
import { useState } from "react";
import { ChevronRight } from "@dya/ui/icons";
import { DialogDrawerHeader } from "@dya/ui/components/dialog-drawer";
import { startAuthentication } from "@simplewebauthn/browser";
import { StandaloneWalletContext, WalletTitle } from "@dya/wallet-ui/components/presentation";
import { WalletPageHeader } from "./wallet-page-header";
import { LegacyDepositForm, type ExactDepositSource } from "@dya/wallet-ui/components/near/transfers";
import { WithdrawalForm, type WithdrawalSource } from "@dya/wallet-ui/components/near/withdrawal-form";
import { TradingInternalSend } from "./trading-internal-send";
import { TradingSendPolicy } from "./trading-send-policy";
type Props = {
  trading?: boolean;
  internalBalances?: { assetId: string; amount: string; decimals: number }[];
  mainInternalAssets?: { assetId: string; symbol: string; decimals: number; blockchain: string }[];
  internalAccounts?: { id: string; name: string; avatarSeed?: string }[];
  withdrawalSource?: WithdrawalSource;
  exactDeposit?: ExactDepositSource;
  direction: "send" | "receive";
  accountId: string;
  avatarSeed?: string;
  onBack: () => void;
  onUpdated: () => void;
  onSignOut: () => void;
};

export function WalletTransfer({ direction, accountId, avatarSeed, onBack, onUpdated, onSignOut, exactDeposit, withdrawalSource, trading, internalAccounts = [], internalBalances = [], mainInternalAssets }: Props) {
  const [busy, setBusy] = useState(false);
  const [sendRoute, chooseSendRoute] = useState<"choose" | "internal" | "external">("choose");
  function finish() { onUpdated(); onBack(); }
  function goBack() {
    if (direction === "send" && sendRoute !== "choose") {
      onUpdated();
      chooseSendRoute("choose");
    } else finish();
  }
  return <>
    <StandaloneWalletContext.Provider value={true}><div className="w-full space-y-6">
      <WalletPageHeader avatarSeed={avatarSeed ?? accountId} title={direction === "receive" ? "Receive" : "Send"} onBack={goBack} onSignOut={onSignOut} disabled={busy} />
      {direction === "receive"
        ? <LegacyDepositForm exactDeposit={exactDeposit} tradingWalletId={trading ? accountId : undefined} accountId={accountId} onBusyChange={setBusy} onClose={finish} onDetails={finish} />
        : sendRoute === "choose" ? <section aria-label="Send destination" className="space-y-4">
          <DialogDrawerHeader>
            <WalletTitle className="sr-only">Where are you sending?</WalletTitle>
          </DialogDrawerHeader>
          <WalletSectionContent><WalletActivityList>
            {([
              { route: "internal", label: "Internal", description: "Between your accounts" },
              { route: "external", label: "External", description: "To an external wallet" },
            ] as const).map(({ route, label, description }) => (
              <WalletActivityRow key={route} title={label} subtitle={description}
                amount={<ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />}
                onClick={() => chooseSendRoute(route)} />
            ))}
          </WalletActivityList></WalletSectionContent>
        </section>
        : sendRoute === "internal" && trading ? <TradingSendPolicy walletId={accountId} onBusyChange={setBusy}>
          <TradingInternalSend walletId={accountId} accounts={internalAccounts} balances={internalBalances} onBusyChange={setBusy} onUpdated={onUpdated} onDone={finish} />
        </TradingSendPolicy>
        : sendRoute === "internal" ? <TradingInternalSend walletId="main" accounts={internalAccounts} balances={internalBalances} mainAssets={mainInternalAssets ?? []} onBusyChange={setBusy} onUpdated={onUpdated} onDone={finish} />
        : trading ? <TradingSendPolicy walletId={accountId} onBusyChange={setBusy}>
            {withdrawalSource && <WithdrawalForm withdrawalSource={withdrawalSource} accountId={accountId} authenticate={startAuthentication} onBusyChange={setBusy} onClose={finish} onDetails={finish} />}
          </TradingSendPolicy>
        : <WithdrawalForm accountId={accountId} authenticate={startAuthentication} onBusyChange={setBusy} onClose={finish} onDetails={finish} />}
    </div></StandaloneWalletContext.Provider>
  </>;
}
