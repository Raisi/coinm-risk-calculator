import Link from "next/link";

const TABS = [
  { id: "swing", href: "/", label: "Swing-Rechner" },
  { id: "2x", href: "/2x/", label: "2x-Strategie" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export function AppHeader({ active }: { active: TabId }) {
  return (
    <header className="masthead">
      <div className="masthead__brand">
        <p className="masthead__eyebrow">Bitunix · BTC Coin-M · inverse Kontrakte</p>
        <h1 className="masthead__title">Coin-M Positionsrechner</h1>
      </div>
      <nav className="tabs" aria-label="Bereiche">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className="tabs__link"
            aria-current={tab.id === active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
