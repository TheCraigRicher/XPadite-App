import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "XPadite",
  description: "Your year at a glance — track, plan, and share progress.",
  applicationName: "XPadite",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iOS "Add to Home Screen". The status bar is solid ("black"), NOT "black-translucent": a translucent bar lets the
  // page draw underneath the clock/notch, and the App's fixed headers have no top safe-area padding.
  appleWebApp: { capable: true, title: "XPadite", statusBarStyle: "black" },
  other: {
    "apple-mobile-web-app-capable": "yes", // older iOS (the Next appleWebApp option emits the newer mobile-web-app-capable)
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7c3aed",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <PwaRegister />
        <AnalyticsProvider />
      </body>
    </html>
  );
}
