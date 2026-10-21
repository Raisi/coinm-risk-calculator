<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git-Workflow (öffentliches Repository)

- Jede Änderung entsteht in einem eigenen Branch von `main`: Features `feature/<kurzname>`, Fehlerbehebungen
  `fix/<kurzname>`, Wartung/Doku `chore/<kurzname>`.
- Nie direkt auf `main` committen oder pushen. Jeder Push auf `main` deployt sofort auf GitHub Pages.
- Branch pushen, Pull Request gegen `main` öffnen. Gemergt wird erst nach grünen Checks (`npm run lint`,
  `npm run typecheck`, `npm test`, Build mit `PAGES_BASE_PATH=/coinm-risk-calculator`) und Freigabe durch den Maintainer.
- Keine Secrets, Schlüssel oder persönlichen Daten committen – das Repository ist öffentlich.
