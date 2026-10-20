export function AppHeader() {
  return (
    <header className="hero">
      <p className="hero__crumb">
        <span>Bitunix</span>
        <span aria-hidden="true">/</span>
        <span className="hero__crumb-accent">BTC Coin-M · invers</span>
      </p>
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
