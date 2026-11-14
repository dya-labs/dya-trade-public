"use client";
import { request } from "@dya/wallet-ui/lib/near/http/request";
import { TOAST_MESSAGES } from "@dya/config";
import { useHapticFeedback } from "@dya/ui/hooks/use-haptic-feedback";
import { z } from "zod";
import { displaySymbol } from "@/lib/near/domain/canonical-assets";
import { limitMinimumSuggestion } from "./limit-minimum-suggestion";
import { ticketErrorCode, ticketErrorField } from "./order-ticket-errors";
import { AppError, ErrorCode, RemoteRequestError, errorMessages } from "@/lib/near/domain/errors";
import { formatNumber } from "@dya/ui/lib/format-number";
import { slippageSettings, type SlippageSettings } from "@/lib/near/http/schemas/trading";
import { createLocalPreference } from "@/lib/local-storage";
import { toast } from "@dya/ui/lib/toast";
import { isConfirmationCancelled } from "@dya/ui/lib/is-confirmation-cancelled";
import { unlockBalances, passkeyError } from "@/lib/near/client/sign-in";
import { abandonLimitOrder, getMarketTradeStatus, prepareLimitOrder as prepareLimitOrderRequest, prepareMarketOrder, submitLimitOrder as submitLimitOrderRequest, submitMarketOrder } from "@/lib/near/http/trading-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { skipToken, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON, type WalletFlow } from "@dya/wallet-sdk";
import type { Snapshot } from "@/lib/near/http/schemas/account";
import type { MarketReview as ExecutableMarketTrade } from "@/lib/near/http/schemas/trading";
import { useMachine } from "@dya/ui/hooks/use-machine";
import { IDLE, attemptBusy, draftLocked, nextAttempt } from "./ticket-attempt";
import { useLiveBalances } from "./use-live-balances";
import { MARKET_QUOTE_DEBOUNCE_MS, useMarketQuote } from "./use-market-quote";
import { DEFAULT_PAIR, quantityRaw, type SelectedPair } from "@/lib/near/domain/catalog";
import { D } from "@/lib/near/domain/decimal";
import { sizeForBalancePercent } from "@/lib/near/domain/order-size";

const slippagePreference = createLocalPreference("dya:market-slippage:v1", slippageSettings);
const sizeUnitPreference = createLocalPreference("dya:trade-size-unit:v1", z.enum(["base", "quote"]));
const walletOriginPreference = createLocalPreference("dya:wallet-origin:v1", z.url());
/** Where DYA ID lives, learned from an approval flow. Never the flow's own address, which names the flow. */
function rememberWalletOrigin(flow: WalletFlow | undefined) {
  try { if (flow) walletOriginPreference.write(new URL(flow.url).origin); } catch { /* Preconnecting is optional. */ }
}
/**
 * Opens a connection to DYA ID while an order is being prepared, where an earlier Review in this
 * browser told where ID lives, so its approval screen does not wait for the connection.
 */
function preconnectWallet() {
  const origin = walletOriginPreference.read();
  if (!origin) return;
  // A new hint each time: one left in the document does not reopen a connection the browser closed.
  document.head.querySelector("link[data-dya-wallet-preconnect]")?.remove();
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  link.dataset.dyaWalletPreconnect = "";
  document.head.append(link);
}

type TradingWallet = ReturnType<typeof import("@dya/wallet-ui/hooks/use-trading-wallet").useTradingWallet>;
export type OutlayerOrderSource = { id: string; wallet: TradingWallet; onSwapSubmitted?: () => void };
type OutlayerOrder = { id: string; base: string; quote: string; side: "buy" | "sell"; rawAmount: string; price?: string; expiryHours?: number };
export type OutlayerReview = OutlayerOrder & { estimatedOutput?: string; minimumOutput?: string };

export function useOrderTicket(account: Snapshot["account"], marketPrice: number | null, pair: SelectedPair = DEFAULT_PAIR, lastPrice: number | null = null, outlayer?: OutlayerOrderSource) {
  const feedback = useHapticFeedback();
  const mounted = useRef(true);
  const unlockController = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; unlockController.current?.abort(); }; }, []);
  const connected = account?.kind === "passkey";
  const queryClient = useQueryClient();
  const main = useLiveBalances(connected && !outlayer ? account!.id : null);
  const balances = outlayer ? { assets: outlayer.wallet.assets ?? [] } : main.balances;
  const balanceError = outlayer ? outlayer.wallet.balance.error?.message ?? "" : main.balanceError;
  const accessRequired = !outlayer && main.accessRequired;
  const loading = outlayer ? outlayer.wallet.balance.isPending : main.loading;
  const refresh = outlayer ? outlayer.wallet.balance.refetch : main.refresh;
  const [outlayerReview, setOutlayerReview] = useState<OutlayerReview>();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderTypeState] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState("");
  const [sizeUnit, setSizeUnit] = useState<"base" | "quote">(() => sizeUnitPreference.read() ?? "base");
  const [slippage, setSlippage] = useState<SlippageSettings>(() => slippagePreference.read() ?? { mode: "default" });
  function changeSlippage(next: SlippageSettings) { setSlippage(next); slippagePreference.write(next); }
  const [quoteAmount, setQuoteAmount] = useState("");
  const [sizePercent, setSizePercent] = useState(0);
  const [percentInput, setPercentInput] = useState("0");
  const [isSliding, setIsSliding] = useState(false);
  const [quoteDelay, setQuoteDelay] = useState(MARKET_QUOTE_DEBOUNCE_MS);
  const [price, setPrice] = useState("");
  const [expiryHours, setExpiry] = useState(24);
  const [attempt, send] = useMachine(nextAttempt, IDLE);
  const busy = attemptBusy(attempt);
  const [limitRequestId, setLimitRequestId] = useState("");
  const [error, setErrorState] = useState("");
  const [sizeErrorMessage, setSizeError] = useState("");
  const [minimumUsd, setMinimumUsd] = useState<string>();
  const suggestedMinimum = minimumUsd ? limitMinimumSuggestion(minimumUsd, pair, sizeUnit, price) : undefined;
  const sizeError = suggestedMinimum ? errorMessages[ErrorCode.LimitOrderSuggestedMinimum](formatNumber(suggestedMinimum, { format: "exact" }), sizeUnit === "base" ? displaySymbol(pair.base) : pair.quote.symbol) : sizeErrorMessage;
  const [priceError, setPriceError] = useState("");
  function setError(value: string) { setErrorState(value); setSizeError(""); setPriceError(""); setMinimumUsd(undefined); }
  function setFailure(cause: unknown, fallback: string) {
    const message = cause instanceof Error ? cause.message : fallback;
    const field = ticketErrorField(ticketErrorCode(cause));
    setError("");
    if (field === "size") {
      setSizeError(message);
      if (cause instanceof RemoteRequestError && cause.remoteCode === ErrorCode.LimitOrderAmountTooSmall) setMinimumUsd(cause.minimumUsd);
    }
    else if (field === "price") setPriceError(message);
    else setError(message);
  }
  // Each submitted trade may settle independently while another is still pending.
  const settlementErrors = useRef(new Set<string>());
  const pendingToastKey = ["near", "account", account?.id, "pending-trade-toasts"];
  const pendingTradeKey = ["near", "account", account?.id, "pending-trade-settlements"];
  const { data: settlingTradeIds = [] } = useQuery<string[]>({
    queryKey: pendingTradeKey, queryFn: skipToken, initialData: [], staleTime: Infinity,
  });
  useQueries({ queries: settlingTradeIds.map(id => ({
    queryKey: ["near", "account", account?.id, "trade-settlement", id], enabled: connected, retry: 1,
    queryFn: async ({ signal, client }) => {
      const toastId = client.getQueryData<Record<string, string>>(pendingToastKey)?.[id] ?? `market-trade-${id}`;
      let trade;
      try {
        ({ trade } = await getMarketTradeStatus(id, signal));
        if (settlementErrors.current.delete(id)) toast.loading(TOAST_MESSAGES.tradeProcessing, { id: toastId });
      } catch (cause) {
        if (!signal.aborted && !settlementErrors.current.has(id)) {
          settlementErrors.current.add(id);
          toast.error(TOAST_MESSAGES.tradeStatusUnavailable, { id: toastId });
        }
        throw cause;
      }
      if (trade.state === "settled" || trade.state === "failed") {
        if (trade.state === "settled") { feedback("success"); toast.success(TOAST_MESSAGES.tradeCompleted, { id: toastId }); }
        else { feedback("error"); toast.error(TOAST_MESSAGES.tradeFailed, { id: toastId }); }
        void client.invalidateQueries({ queryKey: ["near", "account", account?.id, "balances"] });
        queryClient.setQueryData<string[]>(pendingTradeKey, ids => ids?.filter(pendingId => pendingId !== id));
      }
      return trade;
    },
    refetchInterval: 3000,
  })) });
  const asset = balances?.assets.find(a => a.assetId === (side === "buy" ? pair.quote.assetId : pair.base.assetId));
  const sizingPrice = orderType === "limit" ? price : marketPrice;
  const validSizingPrice = typeof sizingPrice === "number" ? Number.isFinite(sizingPrice) && sizingPrice > 0
    : typeof sizingPrice === "string" && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(sizingPrice) && new D(sizingPrice).gt(0);
  const exactSpend = orderType === "market" && side === "buy" && sizeUnit === "quote";
  const marketSizing = exactSpend ? { quoteAmount } : {};
  const canSize = connected && !draftLocked(attempt) && !loading && !balanceError && !!asset && new D(asset.amount).gt(0) &&
    (exactSpend || (side === "sell" && sizeUnit === "base") || validSizingPrice);
  function quoteToQuantity(value: string, reference = sizingPrice) {
    try { quantityRaw(value, pair.quote.decimals); } catch { return ""; }
    try {
      if (!reference || !new D(reference).isFinite() || !new D(reference).gt(0)) return "";
      return new D(value).div(reference).toDecimalPlaces(pair.base.decimals, D.ROUND_DOWN).toFixed();
    } catch { return ""; }
  }
  function editSize(value: string) {
    if (sizeError) setError("");
    if (sizeUnit === "quote") { setQuoteAmount(value); setQuantity(quoteToQuantity(value)); }
    else setQuantity(value);
    setQuoteDelay(MARKET_QUOTE_DEBOUNCE_MS); resetSizePercent(); setLimitRequestId("");
  }
  function changeSizeUnit(unit: "base" | "quote") {
    if (unit === sizeUnit || (unit === "quote" && !validSizingPrice && !(orderType === "market" && side === "buy"))) return;
    if (unit === "base" && exactSpend && currentQuote) setQuantity(currentQuote.estimatedOutput);
    if (unit === "quote") setQuoteAmount(quantity && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(quantity) ? (orderType === "market" && side === "buy" && currentQuote ? currentQuote.principal : new D(quantity).mul(sizingPrice!).toDecimalPlaces(pair.quote.decimals, D.ROUND_DOWN).toFixed()) : "");
    setSizeUnit(unit); sizeUnitPreference.write(unit); setLimitRequestId("");
  }
  function clearSize() { if (sizeError) setError(""); setQuantity(""); setQuoteAmount(""); resetSizePercent(); }
  const lastPriceAvailable = typeof lastPrice === "number" && Number.isFinite(lastPrice) && lastPrice > 0;
  function applyLastPrice() { if (lastPriceAvailable) editPrice(formatNumber(lastPrice, { format: "price" }).replaceAll(",", "")); }
  function setOrderType(next: "market" | "limit") {
    setOrderTypeState(next);
    if (next === "limit" && price === "" && lastPriceAvailable) applyLastPrice();
  }
  function editPrice(value: string) { if (sizeError || priceError) setError(""); setPrice(value); if (sizeUnit === "quote") setQuantity(quoteToQuantity(quoteAmount, value)); resetSizePercent(); setLimitRequestId(""); }
  function resetSizePercent() { setSizePercent(0); setPercentInput("0"); }
  function updateSizePercent(value: number) {
    if (!canSize || !asset) return;
    if (sizeError) setError("");
    const percent = Math.min(100, Math.max(0, Math.trunc(value)));
    setSizePercent(percent);
    setPercentInput(String(percent));
    const next = sizeForBalancePercent({ available: asset.amount, percent, side, price: sizingPrice, reservePercent: orderType === "market" ? 0 : 1, decimals: pair.base.decimals });
    setQuantity(next);
    // USDC amounts filled from a percentage stop at whole cents, matching the two-decimal balance and
    // order value beside them (100% of 9.998155 is 9.99, not a size that reads above "9.99 available").
    const quotePlaces = pair.quote.assetId === DEFAULT_PAIR.quote.assetId ? Math.min(2, pair.quote.decimals) : pair.quote.decimals;
    if (sizeUnit === "quote") setQuoteAmount(side === "buy" ? new D(asset.amount).mul(percent).div(100).toDecimalPlaces(quotePlaces, D.ROUND_DOWN).toFixed() : next && validSizingPrice ? new D(next).mul(sizingPrice!).toDecimalPlaces(quotePlaces, D.ROUND_DOWN).toFixed() : "");
    setLimitRequestId("");
  }
  function editSizePercent(value: string) {
    if (!/^\d{0,3}$/.test(value)) return;
    if (!value) {
      setPercentInput(""); setSizePercent(0); setQuantity(""); setQuoteAmount(""); setLimitRequestId("");
      return;
    }
    setQuoteDelay(MARKET_QUOTE_DEBOUNCE_MS);
    updateSizePercent(Number(value));
  }
  const orderValue = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(quantity) && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(price)
    ? new D(quantity).mul(price).toFixed() : "0";
  let validQuantity = false;
  try { quantityRaw(exactSpend ? quoteAmount : quantity, exactSpend ? pair.quote.decimals : pair.base.decimals); validQuantity = true; } catch { /* Input is incomplete. */ }
  const validLimitPrice = /^(0|[1-9][0-9]{0,38})(\.[0-9]{1,38})?$/.test(price) && new D(price).gt(0);
  const quoteKey = !outlayer && connected && !balanceError && !loading && orderType === "market" && validQuantity
    ? `${account?.id}:${pair.id}:${side}:${exactSpend ? `quote:${quoteAmount}` : quantity}:${JSON.stringify(slippage)}` : "";
  const onAffordableSize = useCallback((next: string) => setQuantity(next), []);
  const { currentQuote, currentQuoteError, currentQuoteErrorCode, retryQuote } = useMarketQuote({ suspended: busy, ...marketSizing, slippage, baseAssetId: pair.base.assetId, quoteAssetId: pair.quote.assetId, decimals: pair.base.decimals, quoteKey, side, quantity, sizePercent: sizeUnit === "quote" && side === "buy" ? 100 : sizePercent, available: sizeUnit === "quote" && side === "buy" ? quoteAmount || undefined : asset?.amount, isSliding, quoteDelay, onAffordableSize });
  const quotePending = !!quoteKey && !currentQuote && !currentQuoteError;
  // An exact USDC spend is its own order value; only token-sized orders estimate it from the reference price.
  const approximateValue = orderType !== "market" ? null : exactSpend ? validQuantity && new D(quoteAmount).gt(0) ? quoteAmount : null
    : /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(quantity) && new D(quantity).gt(0) && typeof marketPrice === "number" && Number.isFinite(marketPrice) && marketPrice > 0
      ? new D(quantity).mul(marketPrice).toFixed() : null;
  function checkMarketBudget(principal: string) {
    if (side === "buy" && sizeUnit === "quote" && (!quoteAmount || new D(principal).gt(quoteAmount))) throw new AppError(ErrorCode.QuoteExceedsEnteredBudget, pair.quote.symbol);
    if (side === "buy" && sizePercent > 0 && (!asset || new D(principal).gt(new D(asset.amount).mul(sizePercent).div(100))))
      throw new AppError(ErrorCode.QuoteExceedsPercentageBudget);
  }
  async function confirmAccess() {
    if (!mounted.current || !send({ type: "unlock" })) return;
    const controller = new AbortController();
    unlockController.current = controller;
    setError("");
    try {
      await unlockBalances(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      await queryClient.invalidateQueries({ queryKey: ["near", "account", account?.id] });
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        if (isConfirmationCancelled(error)) toast(TOAST_MESSAGES.confirmationCancelled);
        else setError(passkeyError(error));
      }
    }
    finally { if (unlockController.current === controller) unlockController.current = null; send({ type: "settle" }); }
  }
  async function openReview() {
    if (attempt.phase !== "idle") return;
    if (outlayer) {
      if (!validQuantity || (orderType === "limit" && !validLimitPrice)) return;
      const amountInQuote = orderType === "market" && side === "buy";
      const input = amountInQuote ? (exactSpend ? quoteAmount : approximateValue) : quantity;
      if (!input) { setError("Market price unavailable."); return; }
      try {
        const rawAmount = quantityRaw(input, amountInQuote ? pair.quote.decimals : pair.base.decimals);
        const order: OutlayerOrder = { id: crypto.randomUUID(), base: pair.base.assetId, quote: pair.quote.assetId, side, rawAmount,
          ...(orderType === "limit" ? { price, expiryHours } : {}) };
        if (orderType === "market") {
          if (!send({ type: "review", order: "market", reusesQuote: false })) return;
          try {
            const quote = await request(`outlayer/send-policy/trade-quote?${new URLSearchParams({ account: outlayer.id })}`,
              z.object({ amount_out: z.string().regex(/^\d+$/), min_amount_out: z.string().regex(/^\d+$/) }), order);
            const decimals = side === "buy" ? pair.base.decimals : pair.quote.decimals;
            setOutlayerReview({ ...order, estimatedOutput: new D(quote.amount_out).div(new D(10).pow(decimals)).toFixed(),
              minimumOutput: new D(quote.min_amount_out).div(new D(10).pow(decimals)).toFixed() });
          } catch (cause) { setFailure(cause, "Unable to get an OutLayer quote."); }
          finally { send({ type: "settle" }); }
          return;
        }
        setOutlayerReview(order);
        setError("");
      } catch { setError("Enter a valid order size."); }
      return;
    }
    preconnectWallet();
    if (orderType === "market") { await reviewMarketOrder(); return; }
    await reviewLimitOrder();
  }
  async function reviewLimitOrder() {
    if (!mounted.current || !validQuantity || !validLimitPrice || !send({ type: "review", order: "limit", reusesQuote: false })) return;
    setError("");
    const requestId = limitRequestId || crypto.randomUUID();
    setLimitRequestId(requestId);
    const toastId = `limit-order-${requestId}`;
    let approvalStarted = false;
    let receiptStarted = false;
    async function abandonPrepared() {
      send({ type: "abandon", requestId });
      try { await abandonLimitOrder(requestId); if (mounted.current) setLimitRequestId(""); }
      catch { send({ type: "abandonFailed" }); if (mounted.current) setError("Couldn’t confirm cancellation. Retry cancellation before placing another order."); }
    }
    try {
      const prepared = await prepareLimitOrderRequest({ side, quantity, price, expiryHours, baseAssetId: pair.base.assetId, quoteAssetId: pair.quote.assetId, requestId, walletFlow: true });
      rememberWalletOrigin(prepared.walletFlow);
      if (!mounted.current) { await abandonPrepared(); return; }
      if (prepared.review.shortfall !== "0") { await abandonPrepared(); setFailure(new AppError(ErrorCode.InsufficientFundingBalance), "Insufficient balance"); return; }
      const deadline = prepared.review.fundingExpiresAt;
      if (deadline !== undefined && !(Date.parse(deadline) > Date.now())) { await abandonPrepared(); setError("Funding confirmation expired. Review again."); return; }
      send({ type: "approval" });
      approvalStarted = true;
      toast.loading(TOAST_MESSAGES.orderConfirming, { id: toastId });
      const assertion = await startAuthentication({ optionsJSON: prepared.options, ...(prepared.walletFlow ? { flow: prepared.walletFlow } : {}) });
      if (!mounted.current) { toast.dismiss(toastId); return; }
      if (!("dyaApproval" in assertion) && deadline !== undefined && !(Date.parse(deadline) > Date.now())) { toast.dismiss(toastId); await abandonPrepared(); setError("Funding confirmation expired. Review again."); return; }
      toast.loading(TOAST_MESSAGES.orderSubmitting, { id: toastId });
      receiptStarted = true; send({ type: "submission" });
      await submitLimitOrderRequest(assertion);
      if (!mounted.current) { toast.success(TOAST_MESSAGES.limitOrderSubmitted, { id: toastId }); return; }
      clearSize(); setPrice(""); setLimitRequestId("");
      feedback("success"); toast.success(TOAST_MESSAGES.limitOrderSubmitted, { id: toastId });
      void queryClient.invalidateQueries({ queryKey: ["near", "account", account?.id] });
    } catch (cause) {
      if (!mounted.current) { toast.error(TOAST_MESSAGES.orderStatusUnavailable, { id: toastId }); return; }
      const name = cause && typeof cause === "object" && "name" in cause ? cause.name : "";
      if (!receiptStarted && (name === "NotAllowedError" || name === "WalletQuoteExpiredError")) {
        toast.dismiss(toastId);
        await abandonPrepared(); toast(name === "WalletQuoteExpiredError" ? TOAST_MESSAGES.confirmationExpired : TOAST_MESSAGES.confirmationCancelled);
      } else if (approvalStarted) {
        // DYA ID may have funded the order before its approval failed to return.
        toast.error(TOAST_MESSAGES.orderStatusUnavailable, { id: toastId });
        feedback("error"); send({ type: "lost" }); setError("Funding could not be confirmed. Check Orders before placing another order.");
        void queryClient.invalidateQueries({ queryKey: ["near", "account", account?.id] });
      } else { setFailure(cause, "Couldn’t prepare your order. Try again."); }
    } finally { send({ type: "settle" }); }
  }
  /** Retries cancelling a prepared limit order whose cancellation did not confirm. */
  async function retryAbandonment() {
    if (attempt.phase !== "abandonFailed" || !send({ type: "retryAbandon" })) return;
    try {
      await abandonLimitOrder(attempt.requestId);
      if (!mounted.current) return;
      setError(""); setLimitRequestId("");
      void queryClient.invalidateQueries({ queryKey: ["near", "account", account?.id] });
    } catch {
      send({ type: "abandonFailed" });
      if (mounted.current) setError("Couldn’t confirm cancellation. Retry cancellation; this attempt is retained for recovery.");
    } finally { send({ type: "settle" }); }
  }
  async function executeMarketTrade(marketReview: ExecutableMarketTrade, options: PublicKeyCredentialRequestOptionsJSON, flow?: WalletFlow) {
    if (!(Date.parse(marketReview.expiresAt) > Date.now())) { setError("Quote expired. Review again for a new quote."); return; }
    let submissionStarted = false;
    const toastId = `market-trade-${account?.id}-${marketReview.correlationId}-${crypto.randomUUID()}`;
    toast.loading(TOAST_MESSAGES.orderConfirming, { id: toastId });
    try {
      send({ type: "approval" });
      const assertion = await startAuthentication({ optionsJSON: options, ...(flow ? { flow } : {}) });
      if (!mounted.current) { toast.dismiss(toastId); return; }
      // ID may have already submitted before its completion receipt reaches Terminal.
      // Always retrieve that receipt; ID enforces expiry before signing/submission.
      if (!("dyaApproval" in assertion) && Date.parse(marketReview.expiresAt) <= Date.now()) { toast.dismiss(toastId); setError("This quote has expired. Refresh it before confirming."); return; }
      submissionStarted = true;
      send({ type: "submission" });
      toast.loading(TOAST_MESSAGES.orderSubmitting, { id: toastId });
      const { trade } = await submitMarketOrder(assertion);
      queryClient.setQueryData<Record<string, string>>(pendingToastKey, ids => ({ ...ids, [trade.id]: toastId }));
      toast.loading(TOAST_MESSAGES.tradeProcessing, { id: toastId });
      queryClient.setQueryData<string[]>(pendingTradeKey, ids => !ids || ids.includes(trade.id) ? ids : [...ids, trade.id]);
      clearSize();
      void queryClient.invalidateQueries({ queryKey: ["near", "account", account?.id] });
    } catch (cause) {
      if (submissionStarted) toast.error(TOAST_MESSAGES.orderStatusUnavailable, { id: toastId }); else toast.dismiss(toastId);
      if (!submissionStarted && cause && typeof cause === "object" && "name" in cause && cause.name === "WalletQuoteExpiredError") { toast(TOAST_MESSAGES.quoteExpired); return; }
      if (!submissionStarted && cause && typeof cause === "object" && "name" in cause && cause.name === "NotAllowedError") { toast(TOAST_MESSAGES.confirmationCancelled); return; }
      feedback("error");
      if (submissionStarted) { send({ type: "lost" }); void queryClient.invalidateQueries({ queryKey: ["near", "account", account?.id] }); }
      setError(submissionStarted ? "Submission could not be confirmed. Check My trades before placing another order." : passkeyError(cause));
    }
  }
  async function reviewMarketOrder() {
    // A ready quote is reused by Review (no new quote), so the ticket says it is opening the review.
    if (!mounted.current || !validQuantity || !send({ type: "review", order: "market", reusesQuote: !!currentQuote?.quoteReference })) return;
    setError("");
    try {
      const prepared = await prepareMarketOrder({ ...(currentQuote?.quoteReference ? { quoteReference: currentQuote.quoteReference } : {}), ...marketSizing, slippage, side, quantity, baseAssetId: pair.base.assetId, quoteAssetId: pair.quote.assetId, walletFlow: true });
      rememberWalletOrigin(prepared.walletFlow);
      if (!mounted.current) return;
      checkMarketBudget(prepared.review.principal);
      if (prepared.review.shortfall !== "0") { setFailure(new AppError(ErrorCode.InsufficientFundingBalance), "Insufficient balance"); return; }
      await executeMarketTrade(prepared.review, prepared.options, prepared.walletFlow);
    } catch (cause) { if (mounted.current) setFailure(cause, "Couldn’t get a quote. Try again."); }
    finally { send({ type: "settle" }); }
  }

  function closeOutlayerReview() { if (!busy) setOutlayerReview(undefined); }
  async function confirmOutlayerReview() {
    if (!outlayer || !outlayerReview || !send({ type: "review", order: outlayerReview.price ? "limit" : "market", reusesQuote: false })) return;
    send({ type: "approval" });
    send({ type: "submission" });
    const { estimatedOutput, minimumOutput, ...order } = outlayerReview;
    void estimatedOutput; void minimumOutput;
    setOutlayerReview(undefined);
    try {
      const result = await request(`outlayer/send-policy/trade?${new URLSearchParams({ account: outlayer.id })}`,
        z.object({ status: z.string().optional(), request_id: z.string().optional(), order_id: z.string().optional() }), order);
      if (!order.price && result.request_id) outlayer.wallet.trackSwap(result.request_id, result.status);
      if (result.status === "pending_approval") setError("OutLayer requires approval for this order.");
      else {
        toast.success(order.price ? "Limit order submitted" : "Swap submitted");
        clearSize();
        if (order.price) void queryClient.invalidateQueries({ queryKey: ["id", "trading-open-orders", outlayer.id] });
        else outlayer.onSwapSubmitted?.();
      }
    } catch (cause) {
      setFailure(cause, "Check Trading activity before submitting again.");
    } finally {
      send({ type: "settle" });
      void outlayer.wallet.balance.refetch();
      void outlayer.wallet.activity.refetch();
    }
  }

  return { setOutlayerReview, outlayerReview, closeOutlayerReview, confirmOutlayerReview, sizeError, priceError, currentQuoteErrorCode, lastPriceAvailable, applyLastPrice, slippage, changeSlippage, attempt, retryAbandonment, sizeUnit, quoteAmount, editSize, changeSizeUnit, clearSize, editPrice, validSizingPrice, validQuantity, validLimitPrice, connected, accessRequired, confirmAccess, balances, balanceError, loading, refresh, side, setSide, orderType, setOrderType, quantity, setQuantity, sizePercent, setSizePercent, percentInput, setPercentInput, isSliding, setIsSliding, quoteDelay, setQuoteDelay, price, setPrice, expiryHours, setExpiry, limitRequestId, setLimitRequestId, error, setError, asset, canSize, resetSizePercent, updateSizePercent, editSizePercent, orderValue, quoteKey, currentQuote, currentQuoteError, retryQuote, quotePending, approximateValue, openReview };
}
