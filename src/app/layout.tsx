import type { Metadata } from "next";
import { Outfit, UnifrakturMaguntia } from "next/font/google";

import "./globals.css";

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
      className={`${unifraktur.variable} ${outfit.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
