// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppFooter from "@/components/AppFooter";
import { AppLanguageProvider } from "@/components/AppLanguageProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import PwaInstallBanner from "@/components/PwaInstallBanner";
import IosInstallBanner from "@/components/IosInstallBanner";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import { ToastProvider } from "@/components/Toast";
import { readPublicAppUrl } from "@/lib/public-app-url";
import { TourProvider } from "@/components/tour/TourContext";
import { TourOverlay } from "@/components/tour/TourOverlay";

const appUrl = readPublicAppUrl();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0A0A",
};


export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "ConXion — Dance Networking",
  description: "Discover dancers, teachers, and events. Connect, practise, travel, and grow with the global dance community.",
  icons: {
    icon: "/branding/CONXION-2-favicon.png?v=17",
    shortcut: "/branding/CONXION-2-favicon.png?v=17",
    apple: "/branding/CONXION-2-favicon.png?v=17",
  },
  manifest: "/manifest.json",
  openGraph: {
    siteName: "ConXion",
    title: "ConXion — Dance Networking",
    description: "Discover dancers, teachers, and events. Connect, practise, travel, and grow with the global dance community.",
    // Replace with a proper 1200×630 social share image when available
    images: [
      {
        url: "/branding/CONXION-2.png",
        width: 1200,
        height: 630,
        alt: "ConXion — Dance Networking",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ConXion — Dance Networking",
    description: "Discover dancers, teachers, and events. Connect, practise, travel, and grow with the global dance community.",
    images: ["/branding/CONXION-2.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <body className="pb-24 md:pb-0">
        <AppLanguageProvider>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black focus:shadow-lg"
          >
            Skip to main content
          </a>
          <ToastProvider>
            <TourProvider>
              <ErrorBoundary>
                {children}
                <AppFooter />
                <OfflineBanner />
                <PwaInstallBanner />
                <IosInstallBanner />
                <ServiceWorkerRegistrar />
                <TourOverlay />
              </ErrorBoundary>
            </TourProvider>
          </ToastProvider>
        </AppLanguageProvider>
      </body>
    </html>
  );
}
