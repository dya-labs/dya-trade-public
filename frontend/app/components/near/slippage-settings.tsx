"use client";

import { useState } from "react";
import { Button } from "@dya/ui/components/button";
import { DialogDrawer, DialogDrawerContent, DialogDrawerHeader, DialogDrawerTitle } from "@dya/ui/components/dialog-drawer";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@dya/ui/components/input-group";
import { FormattedNumber } from "@dya/ui/components/formatted-number";
import { Label } from "@dya/ui/components/label";
import { DEFAULT_SLIPPAGE_BPS, type SlippageSettings as Setting } from "@/lib/near/http/schemas/trading";

export function SlippageSettings({ value, disabled, onChange }: {
  value: Setting; disabled: boolean; onChange: (value: Setting) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value.mode === "custom" ? String(value.bps / 100) : String(DEFAULT_SLIPPAGE_BPS / 100));
  const bps = Math.round(Number(custom) * 100);
  const valid = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(custom) && bps >= 1 && bps <= 500;
  function changeOpen(next: boolean) {
    if (next) { setCustom(value.mode === "custom" ? String(value.bps / 100) : String(DEFAULT_SLIPPAGE_BPS / 100)); }
    setOpen(next);
  }
  return <>
    <Button variant="link" size="xs" className="h-auto p-0 text-xs" disabled={disabled} aria-label="Adjust max slippage" onClick={() => changeOpen(true)} title="Maximum tolerance, fixed when you review.">
      <FormattedNumber value={(value.mode === "custom" ? value.bps : DEFAULT_SLIPPAGE_BPS) / 100} format="percentage" />
    </Button>
    <DialogDrawer open={open} onOpenChange={changeOpen}><DialogDrawerContent className="sm:max-w-sm"><DialogDrawerHeader><DialogDrawerTitle>Max slippage</DialogDrawerTitle></DialogDrawerHeader>
      <div className="space-y-4">
        <div className="space-y-2"><InputGroup><InputGroupAddon><Label htmlFor="custom-slippage">Max</Label></InputGroupAddon><InputGroupInput id="custom-slippage" className="text-right" inputMode="decimal" autoComplete="off" value={custom} onChange={event => setCustom(event.target.value)} placeholder="0.3" aria-invalid={!!custom && !valid} /><InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon></InputGroup></div>
        <Button className="w-full" disabled={!valid} onClick={() => { onChange({ mode: "custom", bps }); setOpen(false); }}>Save</Button>
      </div>
    </DialogDrawerContent></DialogDrawer>
  </>;
}
