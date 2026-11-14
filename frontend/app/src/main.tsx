import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { DyaProvider } from "@dya/wallet-react";
import { ThemeProvider } from "@dya/ui/components/theme-provider";
import { Toaster } from "@dya/ui/components/sonner";
import { TooltipProvider } from "@dya/ui/components/tooltip";
import { QueryProvider } from "@/components/query-provider";
import { TerminalRoute } from "@/components/terminal-route";
import { AppErrorBoundary } from "@dya/ui/components/app-error-boundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppErrorBoundary>
        <DyaProvider><QueryProvider><TooltipProvider><TerminalRoute/><Toaster /></TooltipProvider></QueryProvider></DyaProvider>
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
