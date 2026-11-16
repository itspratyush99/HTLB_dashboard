import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { Backdrop } from "@/components/backdrop";
import { APP_NAME, BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "HTLB Systems internal recruitment tracker for ZBM and HOS hiring",
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: "HTLB Tracker", statusBarStyle: "default" },
  robots: { index: false, follow: false }, // internal tool: keep it out of search engines
};

export const viewport: Viewport = {
  themeColor: BRAND.forest,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}>
        <Backdrop />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
