import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BakeryDecorations } from "@/components/bakery-decorations";
import { ThemeProvider, themeBootstrapScript } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prompt Chain Tool",
  description: "A playful bakery-themed kitchen for prompt-chain recipes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <BakeryDecorations />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
