import type { Metadata } from "next";
import { Schibsted_Grotesk, Spline_Sans_Mono, Young_Serif } from "next/font/google";
import "./globals.css";

const display = Young_Serif({
  weight: "400",
  variable: "--font-young-serif",
  subsets: ["latin"],
});

const body = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
});

const data = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dinner Planner",
  description: "Weekly family dinner planner with macro targets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${data.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
