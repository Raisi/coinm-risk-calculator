import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coin-M Positionsrechner",
  description:
    "Positionsgröße, Margin und Liquidationsabstand für Bitunix BTC Coin-M (inverse) Positionen – reine Rechenhilfe im Browser.",
};

export const viewport: Viewport = {
  themeColor: "#f6f2ea",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de">
      <body>
        <div className="shell">
          {children}
          <footer className="footer">Reine Rechenhilfe – keine Signale, keine Anlageberatung.</footer>
        </div>
      </body>
    </html>
  );
}
