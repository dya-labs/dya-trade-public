import { DYA_BRAND, DYA_URLS } from "@dya/config";
import { Geist_Mono } from "next/font/google";
import { Toaster } from "@dya/ui/components/sonner";
import "./globals.css";
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export const metadata = { title: `${DYA_BRAND.idName}`, description: `${DYA_BRAND.idName} wallet authentication and approvals`, openGraph: { type: "website", siteName: DYA_BRAND.idName, title: DYA_BRAND.idName, description: `${DYA_BRAND.idName} wallet authentication and approvals`, images: [{ url: new URL("/og.jpg", DYA_URLS.id).href, width: 1920, height: 1080, alt: "Dya ID — Your assets. Your privacy." }] }, twitter: { card: "summary_large_image", title: DYA_BRAND.idName, images: [new URL("/og.jpg", DYA_URLS.id).href] }, icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.svg", type: "image/svg+xml" }] } };
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  // ID always uses the dark theme. Render it directly instead of injecting a theme script.
  return <html lang="en" className={`dark ${mono.variable} antialiased`} style={{ colorScheme: "dark" }}><body>{children}<Toaster theme="dark" /></body></html>;
}
