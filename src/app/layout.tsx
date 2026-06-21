import type { Metadata } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";

// Urbanist — the design-system font (design-system.md §Typography). Loaded via
// next/font/google for Next.js 16 self-hosting/optimization (no manual <link>).
// Exposed as the --font-urbanist CSS var that globals.css maps to --font-sans.
const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CC-Manager",
  description: "Personal credit card management — spends, payments, milestones, rewards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${urbanist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
