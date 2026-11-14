"use client";
import { Explainer } from "@dya/ui/components/explainer";
import { FundingTradingGraphic } from "./funding-trading-graphic";

export function FundingTradingGuide({ onDismiss, step, onStepChange }: { onDismiss: () => void; step?: number; onStepChange?: (step: number) => void }) {
  return <Explainer step={step} onStepChange={onStepChange} label="Funding and Trading explained" onComplete={onDismiss} slides={[
    { title: "Deposits arrive in Funding", description: "Your deposited stablecoins stay on their funding networks.", graphic: <FundingTradingGraphic stage="funding" /> },
    { title: "Move funds to Trading", description: "Convert supported stablecoins to USDC on NEAR. Review amounts and fees before confirming.", graphic: <FundingTradingGraphic stage="transfer" /> },
    { title: "You’re ready to trade", description: "Use your Trading balance to buy or sell. Moving funds does not place a trade.", graphic: <FundingTradingGraphic stage="ready" /> },
  ]} />;
}
