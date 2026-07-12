import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";

import "./globals.css";

// One family, everywhere (Iteration 6 design): hierarchy comes from weight,
// size and state colour rather than from a second face.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Say It With a Playlist",
  description:
    "Type a sentence, get a Spotify playlist whose track titles spell it out.",
};

// Matches the page background (Radix sand-2), so mobile browser chrome blends
// into the canvas instead of banding against it.
export const viewport: Viewport = {
  themeColor: "#f9f9f8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* The rail carries a lot of controls before the canvas in tab order. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
