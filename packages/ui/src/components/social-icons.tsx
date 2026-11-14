import type { SVGProps } from "react";

/** Brand marks inherit text color; link/button text supplies their accessible name. */
export function XIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.2-8.4L.8 2h6.5l4.5 6.7L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z"/></svg>;
}
export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d="M9.04 15.47 8.67 20.7c.53 0 .76-.23 1.03-.5l2.48-2.37 5.14 3.76c.94.52 1.6.25 1.86-.87l3.37-15.8c.3-1.4-.5-1.95-1.42-1.6L1.26 10.9c-1.36.53-1.34 1.3-.23 1.64l5.08 1.58 11.79-7.44c.55-.37 1.06-.17.65.2Z"/></svg>;
}
