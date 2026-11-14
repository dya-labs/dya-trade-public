import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "@dya/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@dya/ui/components/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@dya/ui/components/dialog";

function OverlayPreview() {
  const [open, setOpen] = useState(true);
  return (
    <main className="min-h-dvh bg-background p-4 text-foreground">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-medium">Dya.trade</span>
        <Button variant="outline" onClick={() => setOpen(true)}>Open preview</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Market overview</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[["NEAR", "$3.74", "+1.38%"], ["ETH", "$2,800.00", "+2.15%"], ["BTC", "$75,000.00", "-0.42%"]].map(([symbol, price, change]) => (
              <div key={symbol} className="flex items-center justify-between border-b py-4">
                <span>{symbol}</span><span className="font-mono">{price}</span>
                <span className={change.startsWith("-") ? "text-destructive" : "text-primary"}>{change}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Sample prices for visual comparison.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Order ticket</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-control p-3 text-muted-foreground">Size <span className="float-right">25 USDC</span></div>
            <Button className="w-full">Review</Button>
          </CardContent>
        </Card>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backdrop preview</DialogTitle>
            <DialogDescription className="sr-only">Preview the shared dark backdrop over a sample workspace.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">The workspace stays visible beneath a dark backdrop.</p>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
const meta = {
  title: "Shared/DialogOverlay",
  component: OverlayPreview,
} satisfies Meta<typeof OverlayPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
