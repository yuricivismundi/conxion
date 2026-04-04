// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import AppFooter from "@/components/AppFooter";
import { AppLanguageProvider } from "@/components/AppLanguageProvider";
import { readPublicAppUrl } from "@/lib/public-app-url";

const appUrl = readPublicAppUrl();

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "ConXion",
  description: "Conecta, practica, viaja, mejora.",
  icons: {
    icon: "/branding/CONXION-2-favicon.png?v=17",
    shortcut: "/branding/CONXION-2-favicon.png?v=17",
    apple: "/branding/CONXION-2-favicon.png?v=17",
  },
  openGraph: {
    siteName: "ConXion",
    images: [
      {
        url: "/branding/CONXION-2-favicon.png?v=17",
        width: 1200,
        height: 600,
        alt: "ConXion logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/branding/CONXION-2-favicon.png?v=17"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="pb-24 md:pb-0">
        <AppLanguageProvider>
          {children}
          <AppFooter />
        </AppLanguageProvider>
      </body>
    </html>
  );
}
