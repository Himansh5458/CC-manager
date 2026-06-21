import type { Metadata } from "next";
import { Urbanist } from "next/font/google";
import "./globals.css";
import Sidebar from "./_components/Sidebar";

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
  // App shell: a fixed full-height sidebar on the left + an independently
  // scrollable content area on the right. `h-full overflow-hidden` on the body
  // pins the shell to the viewport so only the content column scrolls (the
  // sidebar stays put); pages still render their own `<main className="flex-1">`
  // inside the column. See src/app/CLAUDE.md ("Navigation & layout shell").
  return (
    <html lang="en" className={`${urbanist.variable} h-full antialiased`}>
      <body className="flex h-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </body>
    </html>
  );
}
