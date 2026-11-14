"use client";
import { WalletAccountMenuItem } from "@dya/wallet-ui/components/wallet-account-menu-item";
import { DYA_WALLET_NAMES } from "@dya/config";

import Link from "next/link";
import { Plus, ArrowLeft, LogOut, SettingsFilled, ShieldCheck } from "@dya/ui/icons";
import { AccountAvatar } from "@dya/ui/components/account-avatar";
import { Button } from "@dya/ui/components/button";
import { TradingAccountBadge } from "@dya/ui/components/trading-account-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuHeader, DropdownMenuItem, DropdownMenuTrigger } from "@dya/ui/components/dropdown-menu";

type Props = {
  accountName?: string;
  avatarSeed?: string | null;
  title?: string;
  /** Null when confidential balances are locked or valuation is unavailable. */
  accountValue?: string | null;
  /** Back to another page; `onBack` is for in-page steps. */
  backHref?: string;
  onBack?: () => void;
  onSignOut: () => void;
  disabled?: boolean;
  tradingSetupEnabled?: boolean;
  tradingWallet?: { id: string; controllerId: string; name?:string };
  tradingWallets?: {id:string;name:string;controllerId:string}[];
  tradingSetups?: {id:string;name:string}[];
  stayOnPage?: boolean;
  onSelectWallet?: (id: string | null) => void;
  tradingAccountValue?: string | null;
  selectedWallet?: "standard" | "trading";
};

export function WalletPageHeader({ title, accountName, avatarSeed, accountValue = null, tradingAccountValue = null, backHref, onBack, onSignOut, disabled = false, tradingSetupEnabled = false, tradingWallet, tradingWallets, stayOnPage, onSelectWallet, selectedWallet = "standard" }: Props) {
  const wallets = tradingSetupEnabled ? tradingWallets ?? (tradingWallet ? [{...tradingWallet,name:tradingWallet.name??DYA_WALLET_NAMES.legacyTrading}] : []) : [];
  const home = !title && !backHref && !onBack;
  const accountMenu = <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant={home ? "ghost" : "outline"} size="icon" className={home ? "size-11 rounded-full hover:bg-foreground/6 aria-expanded:bg-foreground/6" : "rounded-full p-1"} aria-label={home ? "Settings" : "Account menu"} disabled={disabled} />}>
      {home ? <SettingsFilled className="size-4.5" /> : <AccountAvatar seed={avatarSeed} size="sm" />}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-48">
      {home && <DropdownMenuHeader>{accountName || "Personal"}</DropdownMenuHeader>}
      {home && selectedWallet === "trading" && <DropdownMenuItem render={<Link href="/policy" />}><ShieldCheck />Policy</DropdownMenuItem>}
      <DropdownMenuItem render={<a href="/recovery" />}><ShieldCheck />Recovery wallet</DropdownMenuItem>
      <DropdownMenuItem onClick={onSignOut}><LogOut />Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
  if (home) return <header className="flex min-w-0 items-center gap-3">
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="-ml-2 h-11 min-h-11 min-w-0 max-w-full gap-2 rounded-full py-0 pr-3 pl-2 hover:bg-foreground/6 aria-expanded:bg-foreground/6" aria-label="Switch account" disabled={disabled} />}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-control-border bg-control p-px"><AccountAvatar seed={selectedWallet === "trading" ? tradingWallet?.id : avatarSeed} size="sm" /></span>
        <span className="truncate font-medium">{selectedWallet === "trading" ? tradingWallet?.name ?? DYA_WALLET_NAMES.defaultTrading : DYA_WALLET_NAMES.main}</span>{selectedWallet === "trading" && <TradingAccountBadge />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <WalletAccountMenuItem name={DYA_WALLET_NAMES.main} seed={avatarSeed} selected={selectedWallet === "standard"} value={accountValue}
          render={<Link href="/" onClick={event => { if (stayOnPage) event.preventDefault(); onSelectWallet?.(null); }} />} />
        {wallets.map(wallet => <WalletAccountMenuItem key={wallet.id} name={wallet.name} seed={wallet.id} trading
          selected={selectedWallet === "trading" && wallet.id === tradingWallet?.id}
          value={wallet.id === tradingWallet?.id ? tradingAccountValue : null}
          render={<Link href="/" onClick={event => { if (stayOnPage) event.preventDefault(); onSelectWallet?.(wallet.id); }} />} />)}

        {tradingSetupEnabled && <DropdownMenuItem render={<Link href="/new" />} aria-label="Create account" className="min-h-9 gap-3 px-2 py-0"><span className="flex w-8 items-center justify-center"><Plus className="size-4" /></span>Create account</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
    <div className="ml-auto shrink-0">{accountMenu}</div>
  </header>;
  return <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
    <div className="min-w-0 justify-self-start">
      {backHref ? <Button variant="outline" size="icon" aria-label="Back to wallet" disabled={disabled} nativeButton={false} render={<a href={backHref} />}><ArrowLeft /></Button>
        : onBack ? <Button variant="outline" size="icon" aria-label="Back to wallet" disabled={disabled} onClick={onBack}><ArrowLeft /></Button>
        : <h1 className="break-words">{accountName || "Your account"}</h1>}
    </div>
    {title ? <h1 className="text-center">{title}</h1> : <span aria-hidden="true" />}
    <div className="justify-self-end">{accountMenu}</div>
  </header>;
}
