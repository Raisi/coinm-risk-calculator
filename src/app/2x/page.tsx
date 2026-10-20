import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "2x-Strategie · Coin-M Positionsrechner",
};

const TRANCHES = ["1,25 %", "1,25 %", "2,5 %", "5 %"];

export default function TwoXPage() {
  return (
    <main className="container page">
      <AppHeader active="2x" />
      <article className="strategy">
        <p className="strategy__lead">Regeln der 2x-Strategie zum Nachschlagen – hier wird nichts berechnet.</p>

        <div className="strategy__grid">
          <section className="card stack strategy__setup" aria-labelledby="setup-title">
            <h2 id="setup-title" className="section-title">
              <span className="section-title__num" aria-hidden="true">
                01
              </span>
              Einstellungen
            </h2>
            <dl className="rules">
              <div>
                <dt>Hebel</dt>
                <dd className="rules__value">2x</dd>
              </div>
              <div>
                <dt>Margin-Modus</dt>
                <dd className="rules__value">Isolated</dd>
              </div>
              <div>
                <dt>Multi-Trade</dt>
                <dd>Aus – alle Einstiege bilden eine Position mit Durchschnittspreis.</dd>
              </div>
            </dl>
          </section>

          <section className="card stack strategy__tranches" aria-labelledby="tranches-title">
            <h2 id="tranches-title" className="section-title">
              <span className="section-title__num" aria-hidden="true">
                02
              </span>
              Einstieg in 4 Tranchen
            </h2>
            <ol className="tranches">
              {TRANCHES.map((share, i) => (
                <li key={i} className="tranche">
                  <span className="tranche__step">Tranche {i + 1}</span>
                  <span className="tranche__share">{share}</span>
                </li>
              ))}
            </ol>
            <p className="muted-note">Anteile des Trading-Kapitals, zusammen 10 %.</p>
          </section>

          <section className="card stack strategy__risk" aria-labelledby="risk2x-title">
            <h2 id="risk2x-title" className="section-title">
              <span className="section-title__num" aria-hidden="true">
                03
              </span>
              Risiko
            </h2>
            <ol className="numbered">
              <li>Kein klassischer Stop-Loss – die Liquidation ist die Worst-Case-Grenze.</li>
              <li>Nach jeder Tranche Durchschnitts- und Liquidationspreis neu berechnen.</li>
            </ol>
          </section>
        </div>

        <p className="strategy__source">Quelle: Kurs „2x KryptoStrategie 1.1“.</p>
      </article>
    </main>
  );
}
