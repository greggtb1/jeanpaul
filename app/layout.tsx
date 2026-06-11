import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
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

export const metadata: Metadata = {
  title: "JEAN PAUL : Postulez sans l'effort répétitif",
  description:
    "JEAN PAUL détecte les offres qui vous correspondent, génère un CV et une lettre de motivation propres à chaque offre, et postule pour vous.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${inter.className} ${displayFont.variable}`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
