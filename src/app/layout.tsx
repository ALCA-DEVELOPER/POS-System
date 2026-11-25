import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { InstallPwaBanner } from "@/components/pwa/InstallPwaBanner";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "KulinerKas - POS & Keuangan UMKM F&B",
    template: "%s | KulinerKas",
  },
  description:
    "Platform manajemen keuangan, kalkulasi HPP resep, AI scan struk belanja, dan kasir POS PWA untuk UMKM kuliner.",
  manifest: "/manifest.json",
  applicationName: "KulinerKas",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "KulinerKas",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14532D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={plusJakartaSans.variable}>
      <body className="antialiased selection:bg-[#14532D]/15 selection:text-[#14532D]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-xl focus:bg-[#14532D] focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white"
        >
          Lewati ke konten utama
        </a>
        {children}
        <InstallPwaBanner />
      </body>
    </html>
  );
}
