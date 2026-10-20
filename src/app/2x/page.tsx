import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";

export const metadata: Metadata = {
  title: "2x-Strategie · Coin-M Positionsrechner",
};

const TRANCHES = ["1,25 %", "1,25 %", "2,5 %", "5 %"];

export default function TwoXPage() {
  return (
    <>
      <AppHeader active="2x" />
      <main className="page page--prose">
        <article className="prose">
          <p className="prose__lead">
            Regeln der 2x-Strategie zum Nachschlagen – hier wird nichts berechnet.
          </p>

          <section aria-labelledby="setup-title">
            <h2 id="setup-title" className="section-title">
              Einstellungen
            </h2>
            <dl className="rules">
              <div>
                <dt>Hebel</dt>
                <dd>2x</dd>
              </div>
              <div>
                <dt>Margin-Modus</dt>
                <dd>Isolated</dd>
              </div>
              <div>
                <dt>Multi-Trade</dt>
                <dd>Aus – alle Einstiege bilden eine Position mit Durchschnittspreis.</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="tranches-title">
            <h2 id="tranches-title" className="section-title">
              Einstieg in 4 Tranchen
            </h2>
            <ol className="tranches">
              {TRANCHES.map((share, i) => (
                <li key={i}>
                  <span className="tranches__step">Tranche {i + 1}</span>
                  <span className="tranches__share">{share}</span>
                </li>
              ))}
            </ol>
            <p>Anteile des Trading-Kapitals, zusammen 10 %.</p>
          </section>

          <section aria-labelledby="risk2x-title">
            <h2 id="risk2x-title" className="section-title">
              Risiko
            </h2>
            <ul className="guide__list">
              <li>Kein klassischer Stop-Loss – die Liquidation ist die Worst-Case-Grenze.</li>
              <li>Nach jeder Tranche Durchschnitts- und Liquidationspreis neu berechnen.</li>
            </ul>
          </section>

          <section aria-labelledby="note-title">
            <h2 id="note-title" className="section-title">
              Abgrenzung
            </h2>
            <ul className="guide__list">
              <li>Der 30x-Swing-Trade ist ein anderer Prozess.</li>
              <li>30x stammt nicht aus den Kursunterlagen.</li>
              <li>Journal und Konto getrennt führen.</li>
            </ul>
          </section>

          <p className="prose__source">Quelle: Kurs „2x KryptoStrategie 1.1“.</p>
        </article>
      </main>
    </>
  );
}
