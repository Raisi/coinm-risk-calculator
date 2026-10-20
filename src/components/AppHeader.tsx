import { InfoTip } from "./InfoTip";

export function AppHeader() {
  return (
    <header className="hero">
      <div className="hero__crumb">
        <span>Bitunix</span>
        <span aria-hidden="true">/</span>
        <span className="hero__crumb-accent">BTC Coin-M · invers</span>
        <InfoTip label="Was bedeuten Coin-M und invers?">
          <strong>Coin-M:</strong> Margin, Gewinn und Verlust laufen in BTC, nicht in USDT.{" "}
          <strong>Invers:</strong> Die Positionsgröße zählt in USD, der Gewinn folgt 1/Entry − 1/Exit statt der
          Kursdifferenz – deshalb rechnet der Rechner Risiko und CRV in BTC.
        </InfoTip>
      </div>
      <h1 className="hero__title">
        Coin-M <span className="hero__accent">Positionsrechner</span>
      </h1>
      <p className="hero__lead">
        Positionsgröße, Margin und Liquidation für inverse BTC-Kontrakte – mit Kopierwerten direkt fürs
        Bitunix-Orderpanel.
      </p>
    </header>
  );
}
