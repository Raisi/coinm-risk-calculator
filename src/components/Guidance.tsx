export function Hints() {
  return (
    <section className="guide" aria-labelledby="hints-title">
      <h2 id="hints-title" className="section-title">
        Hinweise
      </h2>
      <ul className="guide__list">
        <li>Futures Unit Setting auf „By Position Size – BTC“ stellen.</li>
        <li>Stop-Trigger auf Mark Price oder Last Price prüfen.</li>
        <li>Limit-Orders mit GTC können später gefüllt werden – Setup vor dem Fill erneut prüfen.</li>
        <li>Formeln sind Näherungen für Isolated-Margin, Bitunix-Panel ist maßgeblich.</li>
      </ul>
    </section>
  );
}

export function BitunixSettings() {
  return (
    <section className="guide" aria-labelledby="bitunix-title">
      <h2 id="bitunix-title" className="section-title">
        Bitunix-Einstellungen
      </h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Futures Unit Settings">
        <table className="units">
          <caption>Futures Unit Setting – was die Eingabe im Orderpanel bedeutet</caption>
          <thead>
            <tr>
              <th scope="col">Einstellung</th>
              <th scope="col">Eingabe bedeutet</th>
              <th scope="col">Wert aus dem Rechner</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">By Qty – USD</th>
              <td>Positionswert in USD (Annahme, nicht offiziell bestätigt)</td>
              <td>Positionswert USD</td>
            </tr>
            <tr>
              <th scope="row">By Cost – BTC</th>
              <td>eingesetzte Margin in BTC beim gewählten Hebel</td>
              <td>Margin BTC</td>
            </tr>
            <tr>
              <th scope="row">By Position Size – BTC</th>
              <td>Positionsgröße in BTC – empfohlene Einstellung</td>
              <td>Positionswert BTC</td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl className="guide__facts">
        <div>
          <dt>Margin-Modus</dt>
          <dd>Isolated – nur die Margin dieser Position ist im Risiko; die Liquidationsformeln gelten nur dafür.</dd>
        </div>
        <div>
          <dt>Multi-Trade</dt>
          <dd>
            Aus: weitere Orders in dieselbe Richtung werden zu einer Position mit Durchschnittspreis zusammengefasst –
            Liquidationspreis danach neu prüfen. An: jede Order ist eine eigene Position mit eigener Margin und eigener
            Liquidation. Der Rechner bewertet immer genau eine Position.
          </dd>
        </div>
      </dl>
    </section>
  );
}
