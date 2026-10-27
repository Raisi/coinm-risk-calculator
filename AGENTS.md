<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Projektkontext

Coin-M Positionsrechner: statische Web-App (Deutsch) zum Dimensionieren einer Bitunix BTC Coin-M Position (inverser,
BTC-margined Kontrakt). Funktionen und Formeln stehen im `README.md`; es ist bei jeder Feature-Änderung mitzupflegen.
Live: <https://raisi.github.io/coinm-risk-calculator/>.

- **Stack:** Next.js 16 (App Router, `output: "export"`), React 19, TypeScript, Vitest, GSAP. Kein Tailwind: reines
  CSS in `src/app/globals.css` mit CSS-Variablen (dunkles Theme, Akzent Cyan `--accent-primary`, JetBrains Mono/Outfit,
  `--control-height` = 44px Touch-Ziel) und BEM-artigen Klassen (`field__control`, `copy__button--icon`).
- **Nur Browser:** kein Backend, keine API-Routes, keine Secrets, keine Cookies. Einzige Netzwerkanfrage ist der
  Binance-Coin-M-Kurs (`src/lib/livePrice.ts`), nur per Klick.
- **Aufbau:** Rechenlogik rein und ohne React in `src/lib/` (`calc.ts` Formeln, `evaluate.ts` Validierung/Ampel,
  `format.ts` Parsing/Anzeige/Kopierwerte/Journal, `form.ts` Formularzustand, `balanceLink.ts`, `tpPlan.ts`,
  `livePrice.ts`); Tests liegen daneben als `src/lib/*.test.ts`. UI in `src/components/` (`InputPanel.tsx` Eingaben,
  `Results.tsx` Ergebnisse, `TakeProfits.tsx`, `CopyButton.tsx` für alles Kopierbare).
- **Zahlen:** Eingaben de-DE oder mit Punkt über `parseNumber`; Anzeige de-DE über `formatDe`; Kopierwerte fürs
  Bitunix-Panel mit Punkt, ohne Gruppierung, abgerundet (`toCopyValue`, `COPY_DECIMALS`); Preise auf dem 0,1-USD-Tick
  (`TP_DECIMALS`). Vorhandene Helfer wiederverwenden, keine zweite Konvention einführen.
- **Sprache:** UI-Texte, README und Commit-Betreffs auf Deutsch (`feat:`, `fix:`, `chore:`, `test:`); Code,
  Bezeichner und Kommentare auf Englisch.
- **UI prüfen:** im Browser bei 375px und Desktop; Entry/Stop stehen in halber Breite und sind auf Mobil eng.
  Barrierefreiheit beibehalten: `aria-label`, `sr-only`-Statusmeldungen, 44px-Trefferflächen.

## Git-Workflow (öffentliches Repository)

- Jede Änderung entsteht in einem eigenen Branch von `main`: Features `feature/<kurzname>`, Fehlerbehebungen
  `fix/<kurzname>`, Wartung/Doku `chore/<kurzname>`.
- Nie direkt auf `main` committen oder pushen. Jeder Push auf `main` deployt sofort auf GitHub Pages.
- Branch pushen, Pull Request gegen `main` öffnen. Gemergt wird erst nach grünen Checks (`npm run lint`,
  `npm run typecheck`, `npm test`, Build mit `PAGES_BASE_PATH=/coinm-risk-calculator`) und Freigabe durch den Maintainer.
- Keine Secrets, Schlüssel oder persönlichen Daten committen – das Repository ist öffentlich.
