# Coin-M Positionsrechner

Statische Web-App (Deutsch) zum Dimensionieren einer **Bitunix BTC Coin-M** Position (inverser, BTC-margined
Kontrakt). Aus Kontostand, Risikobudget, Entry und Stop berechnet sie Positionswert (USD/BTC), Margin beim gewählten
Hebel und den geschätzten Liquidationspreis – und prüft per Ampel, ob die Liquidation sicher jenseits des Stops liegt.
Dazu Kopierwerte für das Bitunix-Orderpanel, Preisleiste, Warnungen und Journal-Export (TSV).

Alles läuft im Browser: kein Backend, keine Exchange-API, keine Schlüssel, keine Netzwerkaufrufe.

Live: <https://raisi.github.io/coinm-risk-calculator/> · Fehler und Wünsche bitte als
[Issue](https://github.com/Raisi/coinm-risk-calculator/issues) melden.

## Modi

- **Konto in BTC | USDT.** BTC: Kontostand und Risiko in BTC (bisheriges Verhalten). USDT: Kontostand in USDT, Risiko
  in % oder als fester USDT-Betrag = Verlust bei Stop, bewertet zum Stop-Kurs. Die Position ist dann linear
  `Risiko USDT · Entry / |Entry − Stop|` USD groß; Margin, Liquidation und Kopierwerte bleiben in BTC/USD.
  In beiden Modi zeigt die Risiko-Karte Verlust bei Stop und Gewinn bei TP zusätzlich in USDT (bewertet zum
  Stop-/TP-Kurs, ohne die Kursänderung der BTC-Sicherheit selbst).
- **CRV-Basis BTC | USD.** BTC: Gewinn in BTC ÷ Risiko in BTC (inverser Kontrakt, Long nach oben begrenzt).
  USD: linear `|TP − Entry| / |Entry − Stop|` wie im Chart, TP = Entry + R · (Entry − Stop); ein Short ist hier durch
  TP > 0 begrenzt. Gilt für CRV-Regler, TP, CRV-Kennzahl, Preisleiste, Journal und den TP-Plan.
- **TP-Plan CRV-Stufen | Teil-TPs.** CRV-Stufen: TP-Preise (0,1-USD-Tick) für 1–10 R mit Abstand und Gewinn. Teil-TPs: drei
  TPs mit R und Anteil (Summe 100 %), je TP-Preis, abgerundete Kopiermenge in BTC (Rest auf dem letzten Teil),
  Gewinn sowie Gesamtgewinn und gewichteter CRV.

## Entwicklung

Voraussetzung: Node.js 24 und npm.

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:3000
npm run lint       # ESLint
npm run typecheck  # next typegen && tsc --noEmit
npm test           # Vitest (src/lib/*.test.ts)
npm run build      # statischer Export nach ./out
```

Build für einen Unterpfad (wie auf GitHub Pages):

```bash
PAGES_BASE_PATH=/coinm-risk-calculator npm run build
```

Die Rechenlogik liegt rein und ohne React in `src/lib/` (`calc.ts` Formeln, `evaluate.ts` Validierung und Ampel,
`format.ts` Zahlen-Parsing, de-DE-Anzeige, Kopierwerte, Journal-TSV, `form.ts` Formularzustand inkl. TP-Vorbelegung
für CRV 2, `tpPlan.ts` CRV-Stufen und Teil-TPs).

## Deployment auf GitHub Pages

Der Workflow `.github/workflows/deploy.yml` läuft bei jedem Push auf `main` (und manuell über *Run workflow*):
Lint, Typecheck, Tests, Build mit dem Pages-Basispfad, danach Deployment.

Einmalig im Repository einrichten: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.

## Haftungsausschluss

Reine Rechenhilfe – keine Signale, keine Anlageberatung. Die Formeln sind Näherungen für Isolated-Margin; der
Short-Liquidationspreis ist eine konservative, nicht kalibrierte Näherung. Maßgeblich sind immer die Werte im
Bitunix-Panel. Nutzung auf eigenes Risiko.
