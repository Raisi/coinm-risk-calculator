# Coin-M Positionsrechner

Statische Web-App (Deutsch) zum Dimensionieren einer **Bitunix BTC Coin-M** Position (inverser, BTC-margined
Kontrakt). Aus Kontostand, Risikobudget, Entry und Stop berechnet sie Positionswert (USD/BTC), Margin beim gewählten
Hebel und den geschätzten Liquidationspreis – und prüft per Ampel, ob die Liquidation sicher jenseits des Stops liegt.
Dazu Kopierwerte für das Bitunix-Orderpanel, Preisleiste, Warnungen und Journal-Export (TSV).

Alles läuft im Browser: kein Backend, keine Schlüssel, keine Cookies. Einzige Netzwerkanfrage ist der Binance-Kurs –
nur beim Klick auf **Aktueller Kurs** am Entry-Feld oder **Kurs laden** am Kontostand, ein GET an die öffentliche
Binance-API (siehe unten).

Live: <https://raisi.github.io/coinm-risk-calculator/> · Fehler und Wünsche bitte als
[Issue](https://github.com/Raisi/coinm-risk-calculator/issues) melden.

## Modi

- **Konto in BTC | USDT.** BTC: Kontostand und Risiko in BTC (bisheriges Verhalten). USDT: Kontostand in USDT, Risiko
  in % oder als fester USDT-Betrag = Verlust bei Stop, bewertet zum Stop-Kurs. Die Position ist dann linear
  `Risiko USDT · Entry / |Entry − Stop|` USD groß; Margin, Liquidation und Kopierwerte bleiben in BTC/USD.
  In beiden Modi zeigt die Risiko-Karte Verlust bei Stop und Gewinn bei TP zusätzlich in USDT (bewertet zum
  Stop-/TP-Kurs, ohne die Kursänderung der BTC-Sicherheit selbst).
- **Kontostand BTC und USDT.** Beide Felder stehen nebeneinander; eingeben lässt sich nur das Feld der gewählten
  Kontowährung („zählt für die Berechnung“). Das andere ist gesperrt (nicht fokussier- oder markierbar) und zeigt die
  Umrechnung (gestrichelter Rahmen). Umgerechnet wird zum zuletzt geladenen Binance-Kurs (siehe unten): BTC getippt →
  USDT = BTC × Kurs, auf 2 Nachkommastellen abgerundet; USDT getippt → BTC = USDT ÷ Kurs, auf 8 Nachkommastellen
  (1 Sat) abgerundet. Das zuletzt getippte Feld bleibt immer wie eingegeben; ein neuer Kurs rechnet nur das andere Feld
  neu. Ist das getippte Feld leer, ungültig oder ≤ 0 (oder rundet das Ergebnis auf 0 ab), wird das andere leer. Ohne
  geladenen Kurs bleibt das gesperrte Feld unverändert. Das Umschalten von „Konto in“ ändert keinen der beiden Werte,
  macht aber das andere Feld eingebbar.
- **CRV-Basis BTC | USD.** BTC: Gewinn in BTC ÷ Risiko in BTC (inverser Kontrakt, Long nach oben begrenzt).
  USD: linear `|TP − Entry| / |Entry − Stop|` wie im Chart, TP = Entry + R · (Entry − Stop); ein Short ist hier durch
  TP > 0 begrenzt. Gilt für CRV-Regler, TP, CRV-Kennzahl, Preisleiste, Journal und den TP-Plan.
- **TP-Plan CRV-Stufen | Teil-TPs.** CRV-Stufen: TP-Preise (0,1-USD-Tick) für 1–10 R mit Abstand und Gewinn. Teil-TPs: drei
  TPs mit R und Anteil (Summe 100 %), je TP-Preis, abgerundete Kopiermenge in BTC (Rest auf dem letzten Teil),
  Gewinn sowie Gesamtgewinn und gewichteter CRV.

## Aktueller Kurs

Die App kennt einen Live-Kurs: den aktuellen Preis des Binance Coin-M Perpetuals `BTCUSD_PERP` (gleicher Kontrakttyp
wie Bitunix BTC Coin-M; die Bitunix-API erlaubt keinen Abruf von einer statischen Seite). Er kann leicht vom
Bitunix-Kurs abweichen und wird nur per Klick geladen:

- **Aktueller Kurs** unter dem Entry-Feld setzt Entry auf den Kurs, abgerundet auf den 0,1-USD-Tick. Der Wert wird
  wie ein getippter Entry übernommen; mit CRV-Ziel wird TP neu berechnet. Darunter stehen Quelle und Zeit des Kurses.
  Derselbe Kurs wird auch der Umrechnungskurs des Kontostands.
- **Kurs laden** am Kontostand lädt nur den Umrechnungskurs; Entry bleibt unverändert. Daneben steht der Kurs mit
  Quelle und Zeit, z. B. „1 BTC = 81.774,3 USDT · Binance Coin-M BTCUSD_PERP · 11:55:08“.

- Je Klick genau eine Anfrage an `https://dapi.binance.com/dapi/v1/ticker/price?symbol=BTCUSD_PERP`, ohne Cookies
  und ohne Cache. Kein Abruf beim Laden der Seite, bei Eingaben oder beim Umschalten der Kontowährung, kein Polling.
- Während eines Abrufs sind beide Buttons gesperrt; es läuft höchstens eine Anfrage. Nach 8 s oder beim Verlassen der
  Seite wird der Abruf abgebrochen, ein über **Aktueller Kurs** gestarteter auch beim Tippen in Entry; eine verspätete
  Antwort ändert dann nichts mehr.
- Ist Binance nicht erreichbar (z. B. regional gesperrt) oder die Antwort unplausibel, bleiben Entry, beide
  Kontostände und der bisherige Umrechnungskurs unverändert, und am Button erscheint „Kurs nicht abrufbar“.

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
für CRV 2, `balanceLink.ts` Umrechnung Kontostand BTC ↔ USDT, `tpPlan.ts` CRV-Stufen und Teil-TPs, `livePrice.ts`
Abruf und Prüfung des Binance-Kurses).

## Deployment auf GitHub Pages

Der Workflow `.github/workflows/deploy.yml` läuft bei jedem Push auf `main` (und manuell über *Run workflow*):
Lint, Typecheck, Tests, Build mit dem Pages-Basispfad, danach Deployment.

Einmalig im Repository einrichten: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.

## Haftungsausschluss

Reine Rechenhilfe – keine Signale, keine Anlageberatung. Die Formeln sind Näherungen für Isolated-Margin; der
Short-Liquidationspreis ist eine konservative, nicht kalibrierte Näherung. Maßgeblich sind immer die Werte im
Bitunix-Panel. Nutzung auf eigenes Risiko.
