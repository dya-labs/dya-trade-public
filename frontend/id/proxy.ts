import { NextRequest, NextResponse } from "next/server";
import { checkInternalAccess } from "../../backend/id/src/deployment/access";
import { walletClientOrigin } from "../../backend/id/src/bridge/config";
export function proxy(request: NextRequest) {
  const blocked = checkInternalAccess(request);
  const development = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const ancestors = !blocked && request.nextUrl.pathname.startsWith("/flow/") ? `'self' ${walletClientOrigin()}` : "'none'";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Dialog positioning and React styles require style attributes; scripts stay nonce-only.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "img-src 'self' data: blob: https://coin-images.coingecko.com https://assets.coingecko.com https://s2.coinmarketcap.com/static/img/coins/64x64/",
    "font-src 'self'", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-src 'none'", `frame-ancestors ${ancestors}`,
  ].join("; ");
  const headers = new Headers(request.headers);
  // Overwrite incoming values so callers cannot choose the render nonce or policy.
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = blocked ?? NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Permissions-Policy", "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=()");
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (ancestors === "'none'") response.headers.set("X-Frame-Options", "DENY");
  if (request.nextUrl.protocol === "https:") response.headers.set("Strict-Transport-Security", "max-age=31536000");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const config = { matcher: "/:path*" };
