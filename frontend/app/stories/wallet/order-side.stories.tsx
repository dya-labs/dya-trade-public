import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs, TabsList, TabsTrigger } from "@dya/ui/components/tabs";

function OrderSide() {
  const [side, setSide] = useState("buy");
  return <div className="w-full max-w-sm rounded-[var(--radius-panel)] border border-border bg-card p-3">
    <Tabs value={side} onValueChange={value => setSide(String(value))}>
      <TabsList variant="side" sideAppearance="soft" className="grid w-full grid-cols-2" aria-label="Order side">
        <TabsTrigger value="buy" data-tone="buy" className="data-active:text-market-up! dark:data-active:text-market-up!">Buy</TabsTrigger>
        <TabsTrigger value="sell" data-tone="sell" className="data-active:text-market-down! dark:data-active:text-market-down!">Sell</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>;
}
const meta = { title: "App/OrderSide", component: OrderSide } satisfies Meta<typeof OrderSide>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SoftTint: Story = {};
