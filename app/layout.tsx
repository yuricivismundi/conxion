// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import AppFooter from "@/components/AppFooter";

export const metadata: Metadata = {
  title: "ConXion",
  description: "Conecta, practica, viaja, mejora.",
  icons: {
    icon: "/branding/conxion-nav-favicon-black-bg.png?v=10",
    shortcut: "/branding/conxion-nav-favicon-black-bg.png?v=10",
    apple: "/branding/conxion-nav-favicon-black-bg.png?v=10",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>
        {children}
        <AppFooter />
      </body>
    </html>
  );
}
