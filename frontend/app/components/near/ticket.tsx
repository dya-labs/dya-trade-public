"use client";
import { D } from "@/lib/near/domain/decimal";
import { DialogDrawer, DialogDrawerContent, DialogDrawerTitle, DialogDrawerHeader } from "@dya/ui/components/dialog-drawer";
import { TradeReviewAmounts } from "@dya/ui/components/trade-review-amounts";
import { AssetMark } from "@dya/wallet-ui/components/near/asset-mark";
import { FundingBalancePrompt } from "./funding-balance-prompt";
import { feeReceiptSummary } from "@dya/wallet-contracts/src/domain/trading-fees";
import { Tooltip, TooltipContent, TooltipTrigger } from "@dya/ui/components/tooltip";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { ticketErrorField } from "./order-ticket-errors";
import { ErrorCode, errorMessages } from "@/lib/near/domain/errors";
import { SlippageSettings } from "./slippage-settings";
import { MeasuredSkeleton } from "@dya/ui/components/skeleton";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { useEffect, useState } from "react";
import { MARKET_QUOTE_DEBOUNCE_MS } from "./use-market-quote";
import { useOrderTicket, type OutlayerOrderSource, type OutlayerReview } from "./use-order-ticket";
import { draftLocked } from "./ticket-attempt";
import { ticketAction, type TicketActionKind } from "./ticket-action";
import type { Snapshot } from "@/lib/near/http/schemas/account";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dya/ui/components/select";
import type { ReactNode } from "react";
import { Button } from "@dya/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@dya/ui/components/input-group";
import { Label } from "@dya/ui/components/label";
import { ToggleGroup, ToggleGroupItem } from "@dya/ui/components/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@dya/ui/components/tabs";
import { Alert, AlertDescription } from "@dya/ui/components/alert";
import { DEFAULT_PAIR, type SelectedPair, type CatalogAsset } from "@/lib/near/domain/catalog";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { AlertCircle, LoaderCircle } from "@dya/ui/icons";

function AssetAmountInput({
  id,
  label,
  asset,
  value,
  placeholder,
  disabled,
  invalid = false,
  describedBy,
  unitControl,
  onChange,
}: {
  id: string;
  label: string;
  asset: Pick<CatalogAsset, "symbol">;
  value: string;
  placeholder: string;
  disabled: boolean;
  invalid?: boolean;
  describedBy?: string;
  unitControl?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <InputGroup>
      <InputGroupAddon><Label htmlFor={id}>{label}</Label></InputGroupAddon>
      <InputGroupInput id={id} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={invalid ? "text-right tabular-nums text-destructive" : "text-right tabular-nums"} />
      <InputGroupAddon align="inline-end" className={unitControl ? "py-0 pr-1 has-[>button]:mr-0" : undefined}>{unitControl ?? <InputGroupText>{asset.symbol}</InputGroupText>}</InputGroupAddon>
    </InputGroup>
  );
}
export function OrderTicketForm({ account, signIn, marketPrice, lastPrice = null, pair = DEFAULT_PAIR, onBusyChange, onMoveToTrading, unavailable = false, suspended = false, restoring = false, outlayer, chatReview, onChatReviewOpened }: { chatReview?: OutlayerReview; onChatReviewOpened?: () => void; outlayer?: OutlayerOrderSource; restoring?: boolean; onMoveToTrading?: () => void; unavailable?: boolean; /** Upstream (NEAR Intents) outage: disable new order entry instead of surfacing balance/quote errors. */ suspended?: boolean; onBusyChange?: (busy: boolean) => void; pair?: SelectedPair; account: Snapshot["account"]; signIn: () => void; marketPrice: number | null; lastPrice?: number | null }) {
  const feedback = useHapticFeedback();
  const { setOutlayerReview, outlayerReview, closeOutlayerReview, confirmOutlayerReview, balances, sizeError, priceError, currentQuoteErrorCode, attempt, retryAbandonment, lastPriceAvailable, applyLastPrice, slippage, changeSlippage, sizeUnit, quoteAmount, editSize, changeSizeUnit, clearSize, editPrice, validSizingPrice, validQuantity, validLimitPrice, connected, accessRequired, confirmAccess, balanceError, loading, refresh, side, setSide, orderType, setOrderType, quantity, sizePercent, percentInput, setPercentInput, isSliding, setIsSliding, setQuoteDelay, price, expiryHours, setExpiry, setLimitRequestId, error, setError, asset, canSize, updateSizePercent, editSizePercent, orderValue, currentQuote, currentQuoteError, retryQuote, quotePending, approximateValue, openReview } = useOrderTicket(account, marketPrice, pair, lastPrice, outlayer);
  const controlsLocked = restoring || draftLocked(attempt);
  useEffect(() => { onBusyChange?.(controlsLocked); return () => onBusyChange?.(false); }, [controlsLocked, onBusyChange]);
  useEffect(() => {
    if (!chatReview || !outlayer || controlsLocked || unavailable || outlayerReview ||
      chatReview.base !== pair.base.assetId || chatReview.quote !== pair.quote.assetId) return;
    setOutlayerReview(chatReview);
    onChatReviewOpened?.();
  }, [chatReview, outlayer, controlsLocked, unavailable, outlayerReview, pair, setOutlayerReview, onChatReviewOpened]);
  const [retryingBalance, setRetryingBalance] = useState(false);
  const balanceUnavailable = connected && !accessRequired && !!balanceError;
  // An upstream outage pauses new order entry; in-flight attempts keep their recovery actions.
  const paused = suspended && !restoring && attempt.phase === "idle";
  async function retryBalance() {
    if (retryingBalance) return;
    setRetryingBalance(true);
    try { await refresh(); } finally { setRetryingBalance(false); }
  }
  const balanceSymbol = asset ? displaySymbol(asset) : displaySymbol(side === "buy" ? pair.quote : pair.base);
  const balanceContent = !connected && !restoring ? <span>Sign in to view</span> : <MeasuredSkeleton
    key={`${account?.id}:${side === "buy" ? pair.quote.assetId : pair.base.assetId}`}
    loading={restoring || (loading && !asset)}
    label="Loading balance"
    className="tabular-nums"
  >
    <span title={asset ? `${asset.amount} ${balanceSymbol}` : undefined} aria-label={asset ? `${asset.amount} ${balanceSymbol} available` : undefined}>
      {asset || loading || restoring ? <FormattedNumber value={asset?.amount ?? "1000.00"} symbol={balanceSymbol} /> : "-"}
    </span>
  </MeasuredSkeleton>;
  const insufficient = !!currentQuote && currentQuote.shortfall !== "0";
  const action = ticketAction({ attempt, restoring, paused, feeUnverified: currentQuote?.tradingFee?.status === "unverified", connected, accessRequired, balanceUnavailable, retryingBalance, quotePending, sliding: isSliding, quoteFailed: !!currentQuoteError, insufficient, draftValid: validQuantity && (orderType !== "limit" || validLimitPrice) });
  // Every kind names its handler here; a kind without one is never clickable.
  const run: Record<TicketActionKind, (() => void) | undefined> = {
    unavailable: undefined, progress: undefined, checkHistory: undefined, awaitQuote: undefined, insufficient: undefined,
    retryAbandonment: () => void retryAbandonment(), signIn, unlock: () => void confirmAccess(), retryBalance: () => void retryBalance(), retryQuote, review: () => void openReview(),
  };
  const quoteField = ticketErrorField(currentQuoteErrorCode);
  const sizeMessage = sizeError || ((sizeUnit === "quote" ? quoteAmount : quantity) && !validQuantity ? errorMessages[ErrorCode.InvalidAssetQuantity]() : "") || (insufficient ? errorMessages[ErrorCode.InsufficientFundingBalance]() : "") || (quoteField === "size" ? currentQuoteError : "");
  const priceMessage = orderType === "limit" ? priceError || (price && !validLimitPrice ? errorMessages[ErrorCode.PositiveLimitValueRequired]("price") : "") : "";
  const orderMessage = !paused ? error || (balanceUnavailable ? asset ? "Unable to refresh balance." : "Unable to load balance." : currentQuoteError && !quoteField ? currentQuoteErrorCode === ErrorCode.MarketLiquidityUnavailable ? errorMessages[ErrorCode.MarketLiquidityUnavailable]() : "Unable to get a quote. Try again." : "") : "";
  return <section className="flex min-h-full min-w-0 flex-col">
    <DialogDrawer open={!!outlayerReview} onOpenChange={open => { if (!open) closeOutlayerReview(); }}>
      <DialogDrawerContent>
        {outlayerReview && (() => {
          const buy = outlayerReview.side === "buy";
          const limitPrice = outlayerReview.price;
          const pay = buy ? pair.quote : pair.base;
          const receive = buy ? pair.base : pair.quote;
          const sizeAsset = limitPrice ? pair.base : pay;
          const size = new D(outlayerReview.rawAmount).div(new D(10).pow(sizeAsset.decimals));
          const quoteValue = limitPrice ? size.mul(limitPrice) : size;
          return <>
            <DialogDrawerHeader><DialogDrawerTitle>{limitPrice ? "Review limit order" : "Review market trade"}</DialogDrawerTitle></DialogDrawerHeader>
            <TradeReviewAmounts
              pay={{ amount: (buy ? quoteValue : size).toFixed(), symbol: displaySymbol(pay), icon: <AssetMark asset={pay} size={36} /> }}
              receive={{ amount: limitPrice ? (buy ? size : quoteValue).toFixed() : outlayerReview.estimatedOutput ?? null, symbol: displaySymbol(receive), icon: <AssetMark asset={receive} size={36} /> }}
              receiveLabel={limitPrice ? "You receive at limit" : "Estimated receive"}
            />
            {limitPrice ? <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Limit price</dt><dd><FormattedNumber value={limitPrice} symbol={pair.quote.symbol} format="price" exactTooltip /></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Expires after</dt><dd>{outlayerReview.expiryHours === 168 ? "7 days" : `${outlayerReview.expiryHours}h`}</dd></div>
            </dl> : <p className="text-sm text-muted-foreground">A fresh quote is fetched when you confirm.</p>}
            <Button className="w-full" onClick={() => void confirmOutlayerReview()}>Confirm {limitPrice ? "limit order" : "swap"}</Button>
          </>;
        })()}
      </DialogDrawerContent>
    </DialogDrawer>
    <fieldset disabled={paused} className="min-w-0 space-y-2.5 border-0 px-4 py-3 disabled:opacity-60">
      <Tabs value={orderType} onValueChange={value => { feedback(); setOrderType(value as "market" | "limit"); clearSize(); setError(""); }}><TabsList variant="line" className="grid w-full grid-cols-2 gap-0 p-0" aria-label="Order type"><TabsTrigger value="market" disabled={controlsLocked}>Market</TabsTrigger><TabsTrigger value="limit" disabled={controlsLocked}>Limit</TabsTrigger></TabsList></Tabs>
      <Tabs value={side} onValueChange={v => { feedback(); setSide(v as "buy" | "sell"); clearSize(); setError(""); }}><TabsList variant="side" sideAppearance="soft" className="grid w-full grid-cols-2" aria-label="Order side"><TabsTrigger disabled={controlsLocked} value="buy" data-tone="buy" className="data-active:text-market-up! data-active:hover:text-market-up! dark:data-active:text-market-up! dark:data-active:hover:text-market-up!">Buy</TabsTrigger><TabsTrigger disabled={controlsLocked} value="sell" data-tone="sell" className="data-active:text-market-down! data-active:hover:text-market-down! dark:data-active:text-market-down! dark:data-active:hover:text-market-down!">Sell</TabsTrigger></TabsList></Tabs>
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Available to trade</span>{onMoveToTrading && connected && !loading && !balanceError && !accessRequired ? <FundingBalancePrompt balances={balances} disabled={controlsLocked || paused} onMoveToTrading={onMoveToTrading} fallback={balanceContent} /> : balanceContent}</div>
      {orderType === "limit" && <AssetAmountInput id="near-price" label={`Price (${pair.quote.symbol})`} invalid={!!priceMessage} describedBy={priceMessage ? "order-price-error" : undefined} asset={pair.quote} value={price} placeholder="0" disabled={controlsLocked} onChange={editPrice} unitControl={<Button variant="link" size="xs" className="h-6 px-1.5 text-xs" disabled={controlsLocked || !lastPriceAvailable} onClick={applyLastPrice} title="Latest public Intents trade, converted from USD. Unavailable if the trade or conversion price is over 10 minutes old.">Last</Button>} />}
      {priceMessage && <p id="order-price-error" role="alert" className="text-xs text-destructive">{priceMessage}</p>}
      <AssetAmountInput id="near-quantity" label="Size" describedBy={sizeMessage ? "order-size-error" : undefined} invalid={!!sizeMessage} asset={{ symbol: displaySymbol(pair.base) }} value={sizeUnit === "quote" ? quoteAmount : quantity} placeholder="0" disabled={controlsLocked} onChange={editSize} unitControl={<Select value={sizeUnit} onValueChange={value => changeSizeUnit(value as "base" | "quote")}><SelectTrigger variant="embedded" aria-label="Size unit" disabled={controlsLocked} className="min-w-16"><SelectValue>{sizeUnit === "base" ? displaySymbol(pair.base) : pair.quote.symbol}</SelectValue></SelectTrigger><SelectContent><SelectItem value="base">{displaySymbol(pair.base)}</SelectItem><SelectItem value="quote" disabled={!validSizingPrice && !(orderType === "market" && side === "buy")}>{pair.quote.symbol}</SelectItem></SelectContent></Select>} />
      {sizeMessage && <p id="order-size-error" role="alert" className="text-xs text-destructive">{sizeMessage}</p>}
      <div className="flex items-center gap-2" aria-label="Size as percentage of available balance">
        <div className="relative h-5 min-w-0 flex-1">
          <div aria-hidden="true" className="absolute inset-x-[7px] top-1/2 h-1 -translate-y-1/2 rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${sizePercent}%` }} /></div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-[7px] top-1/2 z-[1] flex -translate-y-1/2 justify-between">{[0, 25, 50, 75, 100].map(percent => <span key={percent} className={`size-1 rounded-full ${sizePercent >= percent && canSize ? "bg-primary-foreground" : "bg-muted-foreground"}`} />)}</div>
          <input type="range" aria-label="Size percentage slider" onPointerDown={() => setIsSliding(true)} onPointerUp={() => { setIsSliding(false); setQuoteDelay(0); }} onPointerCancel={() => { setIsSliding(false); setQuoteDelay(0); }} onLostPointerCapture={() => { setIsSliding(false); setQuoteDelay(0); }} onKeyDown={() => setQuoteDelay(MARKET_QUOTE_DEBOUNCE_MS)} min="0" max="100" step="1" value={sizePercent} disabled={!canSize} onChange={event => { const value = Number(event.target.value); const mark = Math.round(value / 25) * 25; updateSizePercent(isSliding && Math.abs(value - mark) <= 1 ? mark : value); }} className="order-size-slider absolute inset-0 z-10 h-full w-full cursor-pointer disabled:cursor-not-allowed" />
        </div>
        <InputGroup className="h-7 w-[60px] shrink-0 rounded-sm border-border bg-transparent dark:has-[[data-slot=input-group-control]:disabled]:bg-transparent">
          <InputGroupInput aria-label="Size percentage input" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={3} value={percentInput} disabled={!canSize} onChange={event => editSizePercent(event.target.value)} onBlur={() => setPercentInput(String(sizePercent))} className="h-full min-w-0 pl-1.5 text-right text-xs tabular-nums md:text-xs" />
          <InputGroupAddon align="inline-end"><InputGroupText aria-hidden="true">%</InputGroupText></InputGroupAddon>
        </InputGroup>
      </div>
      {orderType === "limit" && <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground">Expiry</Label><ToggleGroup aria-label="Expiry" multiple={false} disabled={controlsLocked} value={[String(expiryHours)]} onValueChange={values => { const hours = Number(values[0]); if (![1,24,168].includes(hours)) return; setExpiry(hours); setLimitRequestId(""); }}>{[1,24,168].map(h => <ToggleGroupItem key={h} value={String(h)} size="sm">{h === 168 ? "7d" : h + "h"}</ToggleGroupItem>)}</ToggleGroup></div>}
      {orderMessage && <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertDescription>{orderMessage}</AlertDescription></Alert>}
      <Button className="w-full" disabled={action.disabled} onClick={run[action.kind]}>{action.spinner && <LoaderCircle  aria-hidden="true" />}{action.label}</Button>
    </fieldset>
    <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs" aria-label="Order summary">
      <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Order value</span><FormattedNumber className="font-mono" exactTooltip value={orderType === "limit" ? orderValue !== "0" ? orderValue : null : currentQuote ? side === "buy" ? currentQuote.principal : currentQuote.estimatedOutput : approximateValue} symbol={pair.quote.symbol} /></div>
      {orderType === "market" && <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">You receive</span><FormattedNumber className="font-mono" exactTooltip value={currentQuote?.estimatedOutput ?? null} symbol={side === "buy" ? displaySymbol(pair.base) : pair.quote.symbol} /></div>}
      <div className="flex items-center justify-between gap-2"><Tooltip><TooltipTrigger render={<button type="button" className="text-muted-foreground underline decoration-dotted underline-offset-4" />}>Fees</TooltipTrigger><TooltipContent className="max-w-xs">{currentQuote?.feeReceipt ? feeReceiptSummary(currentQuote.feeReceipt) : currentQuote?.tradingFee?.message ?? "DYA fee rate is available with a quote. Provider fees, spread, slippage and price impact are separate."}</TooltipContent></Tooltip><span className="font-mono tabular-nums">{currentQuote?.feeReceipt ? `${currentQuote.feeReceipt.plan.requestedDyaBps / 100}%` : currentQuote?.tradingFee ? `${currentQuote.tradingFee.dyaBps / 100}%` : "—"}</span></div>
      {orderType === "market" && !outlayer && <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Max Slippage</span><SlippageSettings value={slippage} disabled={controlsLocked || unavailable || paused || attempt.phase !== "idle"} onChange={changeSlippage} /></div>}
    </div>

  </section>;
}

export { OrderTicketForm as OrderTicket };

/** Keep the ticket visible while measuring only its pending balance. */
export function OrderTicketLoading({ label = "Loading order ticket" }: { label?: string } = {}) {
  return <div role="status" aria-label={label}>
    <OrderTicketForm account={null} signIn={() => {}} marketPrice={null} unavailable restoring />
  </div>;
}
