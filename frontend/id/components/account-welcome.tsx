"use client";

import { DYA_BRAND } from "@dya/config";
import { Button } from "@dya/ui/components/button";

export function AccountWelcome({ onContinue }: { onContinue: () => void }) {
  return <div className="space-y-6 text-center">
    <p className="text-muted-foreground">Create one account to manage your assets across networks.</p>
    <Button className="w-full" onClick={onContinue}>Continue</Button>
    <p className="text-xs text-muted-foreground">Protected by <span className="font-medium text-foreground">{DYA_BRAND.idName}</span></p>
  </div>;
}
