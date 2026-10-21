import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const KNOWLEDGE_HUB_URL = "https://raisi.github.io/blockchain-info-helpers/";
const REPO_URL = "https://github.com/Raisi/coinm-risk-calculator";

export const metadata: Metadata = {
  title: "Coin-M Positionsrechner",
  description:
    "Positionsgröße, Margin und Liquidationsabstand für Bitunix BTC Coin-M (inverse) Positionen – reine Rechenhilfe im Browser.",
};

export const viewport: Viewport = {
  themeColor: "#0a0e17",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`${jetbrainsMono.variable} ${outfit.variable}`}>
      <body>
        <header className="site-header">
          <div className="container site-header__inner">
            <Link href="/" className="brand">
              <span className="brand__logo">
                <Icon name="chart" />
              </span>
              <span>
                CoinM<span className="brand__accent">Rechner</span>
              </span>
            </Link>
            <nav className="site-nav" aria-label="Projekte">
              <Link href="/" className="site-nav__link" aria-current="true">
                Rechner
              </Link>
              <a href={KNOWLEDGE_HUB_URL} className="site-nav__link" target="_blank" rel="noopener noreferrer">
                Blockchain Knowledge Hub
                <span className="sr-only">(öffnet in neuem Tab)</span>
                <Icon name="arrowUpRight" size={12} />
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="container site-footer">
          <span className="site-footer__claim">
            <a href={REPO_URL} className="site-footer__link" target="_blank" rel="noopener noreferrer">
              Open Source auf GitHub
              <span className="sr-only">(öffnet in neuem Tab)</span>
              <Icon name="arrowUpRight" size={12} />
            </a>
            <span aria-hidden="true">·</span>
            <a href={`${REPO_URL}/issues`} className="site-footer__link" target="_blank" rel="noopener noreferrer">
              Feedback &amp; Issues
              <span className="sr-only">(öffnet in neuem Tab)</span>
              <Icon name="arrowUpRight" size={12} />
            </a>
            <span aria-hidden="true">·</span>
            <span>läuft lokal</span>
          </span>
          <span>Keine Finanzberatung · Bitunix-Panel ist maßgeblich</span>
        </footer>
      </body>
    </html>
  );
}
