import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Outfit,
  UnifrakturMaguntia,
} from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const unifraktur = UnifrakturMaguntia({
  variable: "--font-blackletter",
  subsets: ["latin"],
  weight: "400",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Say It With a Playlist",
  description:
    "Type a sentence, get a Spotify playlist whose track titles spell it out.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${unifraktur.variable} ${outfit.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
