import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const displayFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--font-display",
});

const siteTitle =
  "JEAN PAUL | Dossiers prêts auto : offres, CV et lettre sur mesure";
const siteDescription =
  "Trouvez les offres qui vous correspondent. JEAN PAUL génère un CV et une lettre par poste, remplit les formulaires. Vous relisez, vous validez.";

function siteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return new URL("http://localhost:3000");
  try {
    return new URL(raw);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: siteTitle,
    template: "%s | JEAN PAUL",
  },
  description: siteDescription,
  keywords: [
    "dossiers prêts",
    "lettre de motivation",
    "CV personnalisé",
    "recherche d'emploi",
    "postuler LinkedIn",
    "postulation automatique",
  ],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "JEAN PAUL",
    title: siteTitle,
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${inter.className} ${displayFont.variable}`} suppressHydrationWarning>
        <Script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="7f67339f-f236-4e56-8cac-0c4216486e16"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
