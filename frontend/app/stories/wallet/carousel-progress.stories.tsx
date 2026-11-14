import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CarouselProgress } from "@dya/ui/components/carousel-progress";
import { FundingTradingGuide } from "@dya/wallet-ui/components/funding-trading-guide";
import { Button } from "@dya/ui/components/button";
import { ArrowLeft, X } from "@dya/ui/icons";

const meta = { title: "Shared/CarouselProgress", component: CarouselProgress, args: { labels: ["Funding", "Trading", "Ready"], current: 0, onSelect: () => {} } } satisfies Meta<typeof CarouselProgress>;
export default meta;
type Story = StoryObj<typeof meta>;
function Preview() {
  const [step, setStep] = useState(0);
  return <section className="min-w-0 overflow-hidden rounded-[var(--radius-dialog)] border border-border bg-popover">
    <div className="relative flex h-11 items-center border-b border-border px-3">{step > 0 && <Button variant="ghost" size="icon-xs" className="absolute left-1" aria-label="Previous explanation step" onClick={() => setStep(step - 1)}><ArrowLeft /></Button>}<h2 className={`w-full text-sm ${step > 0 ? "text-center" : ""}`}>Funding and Trading</h2><X aria-hidden="true" className="absolute right-3 size-3 text-muted-foreground" /></div>
    <div className="min-w-0 p-3"><FundingTradingGuide step={step} onStepChange={setStep} onDismiss={() => setStep(0)} /></div>
  </section>;
}
export const Default: Story = { render: () => <div className="w-full max-w-sm p-6"><Preview /></div> };
