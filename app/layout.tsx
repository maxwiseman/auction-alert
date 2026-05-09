import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auction Alert",
  description: "Auction alerts with iMessage automation and realtime voice AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
