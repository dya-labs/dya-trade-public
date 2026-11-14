"use client";
import { createContext, useContext, type ReactNode } from "react";
import { DialogDrawerTitle, DialogDrawerDescription } from "@dya/ui/components/dialog-drawer";
export const StandaloneWalletContext = createContext(false);
export function WalletTitle({ children, className }: { children: ReactNode; className?: string }) {
  const standalone = useContext(StandaloneWalletContext);
  const entryTitle = children === "Deposit" || children === "Withdraw";
  return standalone ? <h2 className={entryTitle ? "sr-only" : className}>{children}</h2> : <DialogDrawerTitle className={className}>{children}</DialogDrawerTitle>;
}
export function WalletDescription({ children, className }: { children: ReactNode; className?: string }) {
  return useContext(StandaloneWalletContext) ? <p className={className}>{children}</p> : <DialogDrawerDescription className={className}>{children}</DialogDrawerDescription>;
}
