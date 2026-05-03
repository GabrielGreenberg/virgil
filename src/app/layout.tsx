import type { Metadata } from "next";
import { Inter, Playfair_Display, Cinzel, Source_Serif_4, Geist_Mono } from "next/font/google";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const cinzel = Cinzel({
  variable: "--font-logo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Virgil",
  description: "WYSIWYG LaTeX editor",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Virgil",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${cinzel.variable} ${sourceSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#e5e4e1" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4" />
        {/* Picker-pool fonts for the Fonts… dialog. Loaded by their real
            family names (unlike next/font, which generates obfuscated
            names) so the FontPicker's by-name lookup resolves without
            per-font CSS variables. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Lora:wght@400;500;600;700&family=Merriweather:wght@400;700&family=EB+Garamond:wght@400;500;600;700&family=Crimson+Text:wght@400;600;700&family=Cormorant+Garamond:wght@400;500;600;700&family=Open+Sans:wght@400;500;600;700&family=Lato:wght@400;700&family=Roboto:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
