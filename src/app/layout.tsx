import type { Metadata } from "next";
import Script from "next/script";
import TabVisibilityHandler from "@/components/TabVisibilityHandler";
import "./globals.css";
import "@/bones/registry";

export const metadata: Metadata = {
  title: "180ten — Luyện thi JLPT",
  description: "Luyện thi JLPT theo format chuẩn — đề thi, Anki, bảng xếp hạng.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      {
        url: "/favicon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [{ url: "/favicon-512.png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- matches source HTML font link */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&display=swap"
        />
        <Script
          id="prerender-rules"
          type="speculationrules"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              prerender: [
                {
                  where: { href_matches: "/login" },
                  eagerness: "moderate",
                },
              ],
              prefetch: [
                {
                  where: { href_matches: "/*" },
                  eagerness: "conservative",
                },
              ],
            }),
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <TabVisibilityHandler />
        {children}
      </body>
    </html>
  );
}
