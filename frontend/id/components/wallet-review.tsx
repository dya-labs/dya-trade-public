"use client";
import { Tooltip, TooltipTrigger, TooltipContent } from "@dya/ui/components/tooltip";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight } from "@dya/ui/icons";
import { DetailsDisclosure } from "@dya/ui/components/details-disclosure";
import { AssetMark } from "@dya/wallet-ui/components/near/asset-mark";
import { D } from "@dya/wallet-contracts/src/domain/decimal";
import { displaySymbol } from "@dya/wallet-contracts/src/domain/canonical-assets";
import { catalogAsset, type CatalogAsset } from "@dya/wallet-contracts/src/domain/catalog";

import { networkName } from "@dya/wallet-contracts/src/domain/deposit-assets";
import { WalletReviewRow, WalletReviewSummary } from "./wallet-review-summary";
import { TradeReviewAmounts } from "@dya/ui/components/trade-review-amounts";
import { Separator } from "@dya/ui/components/separator";

const subscribeToLocale = () => () => {};
const clientLocaleReady = () => true;
const serverLocaleReady = () => false;

// Keep SSR and the first hydration render identical. Localize only afterwards,
// because the server and browser can have different locales and time zones.
function ReviewDate({ timestamp }: { timestamp: number }) {
  const local = useSyncExternalStore(subscribeToLocale, clientLocaleReady, serverLocaleReady);
  if (!Number.isFinite(timestamp)) return <>-</>;
  const date = new Date(timestamp);
  const iso = date.toISOString();
  return <time dateTime={iso}>{local ? date.toLocaleString() : `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`}</time>;
}

type Review = { title?: string; details?: Record<string, unknown> };
const labels: [string, string][] = [["side", "Side"], ["asset", "Asset"], ["inputAsset", "Pay"], ["inputAmount", "Amount"], ["amount", "Amount"], ["outputAsset", "Receive asset"], ["quantity", "Quantity"], ["price", "Limit price"], ["fundingAsset", "Funding asset"], ["fundingAmount", "Funding amount"], ["recipient", "Recipient"], ["network", "Network"], ["minimumReceived", "Minimum received"], ["minimumOutput", "Minimum output"], ["fees", "Fees"], ["expires", "Expires"]];
/** `now` drives the funding quote countdown; without it the countdown is omitted. */
export function WalletReview({ review, now }: { review?: Review; now?: number }) {
  const details = review?.details ?? {};
  const unlock = review?.title === "Unlock confidential balances";
  const backup = review?.title?.includes("backup");
  const prominent = details.estimatedReceive ?? details.estimatedOutput ?? details.amount;
  const estimated = details.estimatedReceive !== undefined || details.estimatedOutput !== undefined;
  const visibleLabels = labels.filter(([key]) => details[key] !== undefined && (key !== "amount" || estimated));
  function value(key: string) {
    if (key === "expires" && typeof details[key] === "number") return <ReviewDate timestamp={details[key]} />;
    if (key === "price" && details.quoteAsset) return <FormattedNumber value={String(details[key])} symbol={String(details.quoteAsset)} format="exact" />;
    if (["inputAmount", "amount", "quantity", "price", "fundingAmount", "minimumReceived", "minimumOutput"].includes(key)) return <FormattedNumber value={String(details[key])} format="exact" />;
    return String(details[key]);
  }
  if (review?.title === "Fund limit order") return <LimitReview details={details} now={now} />;
  if (review?.title === "Review market trade") return <MarketReview details={details} now={now} />;
  if (review?.title === "Review funding conversion") return <FundingReview details={details} now={now} />;
  return <div className="space-y-3">
    {unlock ? <p className="text-center text-muted-foreground">Use your passkey to access your confidential balances.</p> : backup ? <p className="text-center text-muted-foreground">Approve backup passkey setup. Recovery is not active yet.</p> : null}
    {prominent !== undefined && <WalletReviewSummary label={estimated ? "Estimated receive" : "Amount"}><FormattedNumber value={String(prominent)} symbol={String(details.outputAsset ?? details.asset ?? "")} format="exact" /></WalletReviewSummary>}
    {visibleLabels.length > 0 && <><Separator /><dl className="space-y-2 text-sm">{visibleLabels.map(([key, label]) => <WalletReviewRow key={key} label={label}>{value(key)}</WalletReviewRow>)}</dl></>}
  </div>;
}

function FundingReview({ details, now }: { details: Record<string, unknown>; now?: number }) {
  const [open, setOpen] = useState(false);
  const source = catalogAsset.safeParse(details.sourceAsset);
  const destination = catalogAsset.safeParse(details.destinationAsset);
  const output = String(details.estimatedOutput ?? "");

  const expiry = typeof details.expires === "number" ? details.expires : Date.parse(String(details.expires));
  const seconds = now === undefined ? 0 : Math.max(0, Math.ceil((expiry - now) / 1000));
  return <div className="space-y-4">
    <div className="space-y-1 text-center"><p className="text-3xl font-semibold tabular-nums" title={output}><FormattedNumber value={output} symbol={String(details.outputAsset ?? "")} fractionDigits={2} estimated /></p><p className="text-sm text-muted-foreground">Estimated to receive</p></div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
      <div className="flex flex-col items-center gap-2">{source.success && <AssetMark asset={source.data} network={source.data.blockchain} size={36} />}<p className="text-sm">{String(details.asset ?? "")}{source.success && ` · ${networkName(source.data.blockchain)}`}</p></div>
      <ArrowRight className="mt-2 size-5 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col items-center gap-2">{destination.success && <AssetMark asset={destination.data} network={destination.data.blockchain} size={36} />}<p className="text-sm">{String(details.outputAsset ?? "")}{destination.success && ` · ${networkName(destination.data.blockchain)}`}</p></div>
    </div>
    <DetailsDisclosure label="Details" open={open} onOpenChange={setOpen}>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4"><dt>Amount</dt><dd><FormattedNumber value={String(details.amount ?? "")} symbol={String(details.asset ?? "")} format="exact" /></dd></div>
        <div className="flex justify-between gap-4"><dt>Estimated receive</dt><dd className="break-all text-right"><FormattedNumber value={output} symbol={String(details.outputAsset ?? "")} format="exact" /></dd></div>
        {now !== undefined && Number.isFinite(expiry) && <div className="flex justify-between gap-4"><dt>Quote expires</dt><dd className="tabular-nums">{seconds === 0 ? "Expired" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</dd></div>}
      </dl>
    </DetailsDisclosure>
    <dl className="space-y-2 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Minimum received</dt><dd><FormattedNumber value={String(details.minimumOutput ?? "")} symbol={String(details.outputAsset ?? "")} format="exact" /></dd></div>{"estimatedCost" in details && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Estimated cost</dt><dd><FormattedNumber value={details.estimatedCost == null ? null : String(details.estimatedCost)} format="currency" /></dd></div>}</dl>
  </div>;
}

function usdValue(amount: unknown, asset?: CatalogAsset): string | null {
  if (asset?.price == null || typeof amount !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(amount)) return null;
  const price = new D(asset.price);
  return price.isFinite() && price.gt(0) ? new D(amount).mul(price).toFixed() : null;
}

function marketRate(details: Record<string, unknown>): string | null {
  const base = details.side === "sell" ? details.inputAmount : details.estimatedOutput;
  const quote = details.side === "sell" ? details.estimatedOutput : details.inputAmount;
  if (typeof base !== "string" || typeof quote !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(base) || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(quote)) return null;
  const baseAmount = new D(base), quoteAmount = new D(quote);
  return baseAmount.gt(0) && quoteAmount.gt(0) ? quoteAmount.div(baseAmount).toFixed() : null;
}

function TradingFeeRow({ details }: { details: Record<string, unknown> }) {
  const bps = typeof details.dyaFeeBps === "number" && Number.isFinite(details.dyaFeeBps) ? details.dyaFeeBps : null;
  return <div className="flex justify-between gap-3"><dt><Tooltip><TooltipTrigger render={<button type="button" className="underline decoration-dotted underline-offset-4" />}>Fees</TooltipTrigger><TooltipContent className="max-w-xs">{typeof details.fees === "string" ? details.fees : "DYA fee rate. Provider fees are included in the quote; spread, slippage and price impact are separate."}</TooltipContent></Tooltip></dt><dd className="tabular-nums">{bps === null ? "—" : `${bps / 100}%`}</dd></div>;
}

function MarketReview({ details, now }: { details: Record<string, unknown>; now?: number }) {
  const [open, setOpen] = useState(false);
  const source = catalogAsset.safeParse(details.sourceAsset);
  const destination = catalogAsset.safeParse(details.destinationAsset);
  const inputUsd = usdValue(details.inputAmount, source.success ? source.data : undefined);
  const outputUsd = usdValue(details.estimatedOutput, destination.success ? destination.data : undefined);
  const rate = marketRate(details);
  const baseSymbol = String((details.side === "sell" ? details.inputAsset : details.outputAsset) ?? "");
  const quoteSymbol = String((details.side === "sell" ? details.outputAsset : details.inputAsset) ?? "");
  const expiry = typeof details.expires === "number" ? details.expires : Date.parse(String(details.expires));
  const seconds = now === undefined ? 0 : Math.max(0, Math.ceil((expiry - now) / 1000));
  return <div className="space-y-4">
    <TradeReviewAmounts
      pay={{ amount: String(details.inputAmount ?? ""), symbol: String(details.inputAsset ?? ""), usd: inputUsd, icon: source.success && <AssetMark asset={source.data} size={36} /> }}
      receive={{ amount: String(details.estimatedOutput ?? ""), symbol: String(details.outputAsset ?? ""), usd: outputUsd, icon: destination.success && <AssetMark asset={destination.data} size={36} /> }}
    />
    <div className="space-y-2 text-sm [&_dt]:text-muted-foreground [&_dd]:text-right">
    <DetailsDisclosure className="gap-2" label="Details" open={open} onOpenChange={setOpen}><dl className="space-y-2 text-sm">{rate !== null && <div className="flex justify-between gap-3"><dt>Rate</dt><dd className="break-words">1 {baseSymbol} = <FormattedNumber value={rate} format="price" symbol={quoteSymbol} exactTooltip /></dd></div>}<div className="flex justify-between gap-3"><dt>Route</dt><dd>NEAR Intents</dd></div>{now !== undefined && Number.isFinite(expiry) && <div className="flex justify-between gap-3"><dt>Quote expires</dt><dd>{seconds === 0 ? "Expired" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</dd></div>}</dl></DetailsDisclosure>
    <dl className="space-y-2 text-sm"><TradingFeeRow details={details} />{typeof details.slippageBps === "number" && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Max slippage</dt><dd title="This maximum tolerance is fixed for this review."><FormattedNumber value={details.slippageBps / 100} format="percentage" /></dd></div>}</dl>
    </div>
  </div>;
}

function LimitReview({ details, now }: { details: Record<string, unknown>; now?: number }) {
  const [open, setOpen] = useState(false);
  const base = catalogAsset.safeParse(details.baseAsset);
  const source = catalogAsset.safeParse(details.sourceAsset);
  const funding = String(details.fundingAmount ?? "");
  const fundingUsd = usdValue(funding, source.success ? source.data : undefined);
  const buy = details.side !== "sell";
  const quoteToken = catalogAsset.safeParse(details.quoteToken ?? (buy ? details.sourceAsset : undefined));
  const quantity = String(details.quantity ?? "");
  const price = String(details.price ?? "");
  const numeric = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
  const notional = numeric.test(quantity) && numeric.test(price) ? new D(quantity).mul(price).toFixed() : null;
  const receiveAmount = buy ? quantity : notional;
  const receiveAsset = buy ? base : quoteToken;
  const receiveSymbol = buy ? base.success ? displaySymbol(base.data) : String(details.asset ?? "") : String(details.quoteAsset ?? "");
  const receiveUsd = usdValue(receiveAmount, receiveAsset.success ? receiveAsset.data : undefined);
  const expiry = typeof details.expires === "number" ? details.expires : Date.parse(String(details.expires));
  const seconds = now === undefined ? 0 : Math.max(0, Math.ceil((expiry - now) / 1000));
  const orderExpiry = Date.parse(String(details.orderExpires));
  return <div className="space-y-4">
    <TradeReviewAmounts
      pay={{ amount: funding, symbol: String(details.fundingAsset ?? ""), usd: fundingUsd, icon: source.success && <AssetMark asset={source.data} size={36} /> }}
      receive={{ amount: receiveAmount, symbol: receiveSymbol, usd: receiveUsd, usdTitle: "Value at the current market price", icon: receiveAsset.success && <AssetMark asset={receiveAsset.data} size={36} /> }}
      receiveLabel="You receive at limit"
    />
    <div className="space-y-2 text-sm [&_dt]:text-muted-foreground [&_dd]:text-right">
      <DetailsDisclosure className="gap-2" label="Details" open={open} onOpenChange={setOpen}><dl className="space-y-2">{now !== undefined && Number.isFinite(expiry) && <div className="flex justify-between gap-3"><dt>Confirmation expires</dt><dd>{seconds === 0 ? "Expired" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</dd></div>}</dl></DetailsDisclosure>
      <dl className="space-y-2"><TradingFeeRow details={details} /><div className="flex justify-between gap-3"><dt>Limit price</dt><dd><FormattedNumber value={String(details.price ?? "")} format="price" symbol={String(details.quoteAsset ?? "")} exactTooltip /></dd></div>{Number.isFinite(orderExpiry) && <div className="flex justify-between gap-3"><dt>Order expires</dt><dd><ReviewDate timestamp={orderExpiry} /></dd></div>}</dl>
    </div>
  </div>;
}
