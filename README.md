# Coin-M Positionsrechner

Statische Web-App (Deutsch) zum Dimensionieren einer **Bitunix BTC Coin-M** Position (inverser, BTC-margined
Kontrakt). Aus Kontostand, Risikobudget, Entry und Stop berechnet sie Positionswert (USD/BTC), Margin beim gewählten
Hebel und den geschätzten Liquidationspreis – und prüft per Ampel, ob die Liquidation sicher jenseits des Stops liegt.
Dazu Kopierwerte für das Bitunix-Orderpanel, Preisleiste, Warnungen und Journal-Export (TSV).

Alles läuft im Browser: kein Backend, keine Exchange-API, keine Schlüssel, keine Netzwerkaufrufe.

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
`format.ts` Zahlen-Parsing, de-DE-Anzeige, Kopierwerte, Journal-TSV).

## Deployment auf GitHub Pages

Der Workflow `.github/workflows/deploy.yml` läuft bei jedem Push auf `main` (und manuell über *Run workflow*):
Lint, Typecheck, Tests, Build mit dem Pages-Basispfad, danach Deployment.

Einmalig im Repository einrichten: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.

## Haftungsausschluss

Reine Rechenhilfe – keine Signale, keine Anlageberatung. Die Formeln sind Näherungen für Isolated-Margin; der
Short-Liquidationspreis ist eine konservative, nicht kalibrierte Näherung. Maßgeblich sind immer die Werte im
Bitunix-Panel. Nutzung auf eigenes Risiko.
