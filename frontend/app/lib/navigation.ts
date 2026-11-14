import { DYA_URLS } from "@dya/config";

/** Public app navigation. Keep external destinations in one place. */
export const APP_NAVIGATION = [
  { label: "TRADE", href: "/", view: "trade", external: false },
  { label: "PORTFOLIO", href: "/portfolio", view: "portfolio", external: false },
  { label: "DOCS", href: DYA_URLS.docs, view: null, external: true },
] as const;
