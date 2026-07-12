import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = (incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000")
    .split(",")[0]
    .trim();
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: {
      default: "WHEN? — The daily timeline game",
      template: "%s · WHEN?",
    },
    description:
      "Place surprising events in order and discover which completely unrelated things happened at the same time.",
    applicationName: "WHEN?",
    category: "game",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
        { url: "/favicon.png", sizes: "512x512", type: "image/png" },
      ],
      shortcut: "/favicon.ico",
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      title: "WHEN? — History has weird neighbors",
      description: "Can you put ten completely unrelated moments in the right order?",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1734, height: 907, alt: "WHEN? History has weird neighbors." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "WHEN? — History has weird neighbors",
      description: "Can you put ten completely unrelated moments in the right order?",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
