import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Embedded Wallet Demo",
  description: "Non-custodial embedded wallet with Google login",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
