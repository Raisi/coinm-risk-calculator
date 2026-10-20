import Link from "next/link";

const TABS = [
  { id: "swing", href: "/", label: "Swing-Rechner" },
  { id: "2x", href: "/2x/", label: "2x-Strategie" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export function AppHeader({ active }: { active: TabId }) {
  return (
    <header className="hero">
      <p className="hero__crumb">
        <span>Bitunix</span>
        <span aria-hidden="true">/</span>
        <span className="hero__crumb-accent">BTC Coin-M · invers</span>
      </p>
      <div className="hero__row">
        <div>
          <h1 className="hero__title">
            Coin-M <span className="hero__accent">Positionsrechner</span>
          </h1>
          <p className="hero__lead">
            Positionsgröße, Margin und Liquidation für inverse BTC-Kontrakte – mit Kopierwerten direkt fürs
            Bitunix-Orderpanel.
          </p>
        </div>
        <nav className="mode-tabs" aria-label="Rechner-Modus">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              className="mode-tabs__link"
              aria-current={tab.id === active ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
