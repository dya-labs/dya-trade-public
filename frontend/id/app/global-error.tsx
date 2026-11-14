"use client";
import { ReportedErrorFallback } from "@dya/ui/components/app-error-boundary";
import "./globals.css";

/** Crashes in the root layout itself replace the whole document, so this renders its own html and body. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return <html lang="en" className="dark antialiased" style={{ colorScheme: "dark" }}><body><ReportedErrorFallback error={error} /></body></html>;
}
