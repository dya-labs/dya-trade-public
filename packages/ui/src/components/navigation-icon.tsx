import { useId, type ComponentProps } from "react";

export type NavigationIconName = "markets" | "trade" | "portfolio";

// Remix-based geometry; Trade’s open terminals use Dya-style diagonal cuts.
const shapes: Record<NavigationIconName, string[]> = {
  markets: ["M7 13H9V17H7V13Z", "M11 7H13V17H11V7Z", "M15 10H17V17H15V10Z", "M2 4C2 3.44772 2.44772 3 3 3H14V5H4V19H20V11H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4Z", "M20 1.25L23.75 5L20 8.75L16.25 5Z"],
  trade: ["M7 21.5C4.51472 21.5 2.5 19.4853 2.5 17C2.5 14.5147 4.51472 12.5 7 12.5C9.48528 12.5 11.5 14.5147 11.5 17C11.5 19.4853 9.48528 21.5 7 21.5ZM7 19.5C8.38071 19.5 9.5 18.3807 9.5 17C9.5 15.6193 8.38071 14.5 7 14.5C5.61929 14.5 4.5 15.6193 4.5 17C4.5 18.3807 5.61929 19.5 7 19.5Z", "M16.55 2.7Q17 2.25 17.45 2.7L21.3 6.55Q21.75 7 21.3 7.45L17.45 11.3Q17 11.75 16.55 11.3L12.7 7.45Q12.25 7 12.7 6.55ZM17 4.9L14.9 7L17 9.1L19.1 7Z", "M3 8C3 5.23858 5.23858 3 8 3H12L10 5H8C6.34315 5 5 6.34315 5 8V12L3 10V8Z", "M21 16C21 18.7614 18.7614 21 16 21H12L14 19H16C17.6569 19 19 17.6569 19 16V12L21 14V16Z"],
  portfolio: ["M18.0049 6.99979H21.0049C21.5572 6.99979 22.0049 7.4475 22.0049 7.99979V19.9998C22.0049 20.5521 21.5572 20.9998 21.0049 20.9998H3.00488C2.4526 20.9998 2.00488 20.5521 2.00488 19.9998V3.99979C2.00488 3.4475 2.4526 2.99979 3.00488 2.99979H18.0049V6.99979ZM4.00488 8.99979V18.9998H20.0049V8.99979H4.00488ZM4.00488 4.99979V6.99979H16.0049V4.99979H4.00488Z", "M16.5049 11.25L13.7549 14L16.5049 16.75L19.2549 14Z"],
};

const filledShapes: Record<NavigationIconName, string[]> = {
  "markets": ["M22 20V10.6586C21.3744 10.8797 20.7013 11 20 11C18.9071 11 17.8825 10.7078 17 10.1973V17H15V10H16.6822C15.0655 8.92508 14 7.08697 14 5C14 4.29873 14.1203 3.62556 14.3414 3H3C2.44772 3 2 3.44772 2 4V20C2 20.5523 2.44772 21 3 21H21C21.5523 21 22 20.5523 22 20Z", "M20 1.25L23.75 5L20 8.75L16.25 5Z"],
  "trade": ["M7 21.5C4.51472 21.5 2.5 19.4853 2.5 17C2.5 14.5147 4.51472 12.5 7 12.5C9.48528 12.5 11.5 14.5147 11.5 17C11.5 19.4853 9.48528 21.5 7 21.5Z", "M16.55 2.7Q17 2.25 17.45 2.7L21.3 6.55Q21.75 7 21.3 7.45L17.45 11.3Q17 11.75 16.55 11.3L12.7 7.45Q12.25 7 12.7 6.55Z", "M3 8C3 5.23858 5.23858 3 8 3H12L10 5H8C6.34315 5 5 6.34315 5 8V12L3 10V8Z", "M21 16C21 18.7614 18.7614 21 16 21H12L14 19H16C17.6569 19 19 17.6569 19 16V12L21 14V16Z"],
  "portfolio": ["M2.00488 8.99979H21.0049C21.5572 8.99979 22.0049 9.4475 22.0049 9.99979V19.9998C22.0049 20.5521 21.5572 20.9998 21.0049 20.9998H3.00488C2.4526 20.9998 2.00488 20.5521 2.00488 19.9998V8.99979ZM3.00488 2.99979H18.0049V6.99979H2.00488V3.99979C2.00488 3.4475 2.4526 2.99979 3.00488 2.99979Z", "M16.5049 12.25L13.7549 15L16.5049 17.75L19.2549 15Z"]
};

export function NavigationIcon({ icon, active = false, style, ...props }: ComponentProps<"svg"> & { icon: NavigationIconName; active?: boolean }) {
  const maskId = useId();
  if (icon === "markets") return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={style} {...props}>
    {active ? <>
      <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white"/>{shapes.markets.slice(0, 3).map((d, index) => <path key={index} d={d} fill="black" data-animate-bar=""/>)}</mask></defs>
      <path d="M22 20V10.6586C21.3744 10.8797 20.7013 11 20 11C16.6863 11 14 8.3137 14 5C14 4.29873 14.1203 3.62556 14.3414 3H3C2.44772 3 2 3.44772 2 4V20C2 20.5523 2.44772 21 3 21H21C21.5523 21 22 20.5523 22 20Z" mask={`url(#${maskId})`}/>
    </> : shapes.markets.slice(0, 4).map((d, index) => <path key={index} d={d} data-animate-bar={index < 3 ? "" : undefined}/>)}
    <path d={active ? shapes.markets[4] : `${shapes.markets[4]}M20 3.25L18.25 5L20 6.75L21.75 5Z`} className={active ? "text-primary" : undefined}/>
  </svg>;
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ ...(icon === "trade" ? { transform: active ? "rotate(0deg)" : "rotate(180deg)", transformOrigin: "center", transformBox: "view-box" as const } : {}), ...style }} {...props}>{(active ? filledShapes : shapes)[icon].map((d, index) => <path key={index} d={d} className={active && ((icon === "trade" && index === 1) || (icon === "portfolio" && index === (active ? filledShapes : shapes)[icon].length - 1)) ? "text-primary" : undefined} fill="currentColor"/>)}</svg>;
}

/** Shared wallet identity, also used by Portfolio navigation. */
export function WalletIcon(props: Omit<ComponentProps<typeof NavigationIcon>, "icon">) {
  return <NavigationIcon icon="portfolio" width={24} height={24} {...props}/>;
}

export function TradeIcon(props: Omit<ComponentProps<typeof NavigationIcon>, "icon">) {
  return <NavigationIcon icon="trade" {...props} />;
}
