import { TEXT_SHORT_LIQ_NOTE, type Evaluation, type LiqCheck } from "@/lib/evaluate";
import { COPY_DECIMALS, formatDe, toCopyValue } from "@/lib/format";
import { CopyButton } from "./CopyButton";
import { JournalExport } from "./JournalExport";
import { PriceRail } from "./PriceRail";
import { ResultRow } from "./ResultRow";
import { TakeProfits } from "./TakeProfits";

const usd = (value: number) => `${formatDe(value, 2)} USD`;
const usdt = (value: number) => `${formatDe(value, 2)} USDT`;
const btc = (value: number) => `${formatDe(value, 8)} BTC`;
const pct = (value: number) => `${formatDe(value, 2)} %`;
const price = (value: number) => (Number.isFinite(value) ? `${formatDe(value, 1)} USD` : "keine Liquidation");
const factor = (value: number) => (Number.isFinite(value) ? `${formatDe(value, 2)}×` : "∞");

/** "Liq-Abstand x % · Faktor y×" with the factor in its traffic-light colour. */
function LiqSummary({ check }: { check: LiqCheck }) {
  if (check.distancePct === null) return <>Keine Liquidation</>;
  return (
    <>
      Liq-Abstand {pct(check.distancePct)} · Faktor{" "}
      <span className="factor" data-status={check.status}>
        {factor(check.factor)}
      </span>
    </>
  );
}

interface CopyColumnProps {
  /** Bitunix Futures Unit Setting the value belongs to. */
  setting: string;
  label: string;
  /** Exact de-DE value with unit, shown under the copy value. */
  exact: string;
  copyValue: string;
  recommended?: boolean;
}

function CopyColumn({ setting, label, exact, copyValue, recommended }: CopyColumnProps) {
  return (
    <div className={recommended ? "copy-col copy-col--recommended" : "copy-col"}>
      <dt className="copy-col__head">
        <span className="copy-col__setting">
          {setting}
          {recommended && " · empfohlen"}
        </span>
        <span className="copy-col__label">{label}</span>
      </dt>
      <dd className="copy-col__body">
        <code className="copy-col__value" title="Kopierwert">
          {copyValue}
        </code>
        <span className="copy-col__exact">{exact}</span>
        <CopyButton value={copyValue} subject={label} className={recommended ? "copy__button--primary" : undefined} />
      </dd>
    </div>
  );
}

export function Results({ evaluation: e }: { evaluation: Evaluation }) {
  const { account, direction, crvBasis, entry, stop, tp, leverage } = e.inputs;
  const inAccountUnit = account === "btc" ? btc : usdt;
  return (
    <div className="results">
      <section className="card rail-card" aria-labelledby="rail-title">
        <div className="card__head">
          <h2 id="rail-title" className="section-title">
            Preisleiste
          </h2>
          {e.crv !== null && <span className="card__meta">CRV {formatDe(e.crv, 2)} R</span>}
        </div>
        <PriceRail entry={entry} stop={stop} tp={tp} liq={e.liq} panelLiq={e.panelLiq} />
        <p className="rail-caption">
          <LiqSummary check={e.liq} />
        </p>
        {e.panelLiq !== null && (
          <p className="rail-caption">
            Bitunix-Panel: <LiqSummary check={e.panelLiq} />
          </p>
        )}
      </section>

      <section className="card bitunix" aria-labelledby="copy-title">
        <div className="bitunix__head">
          <h2 id="copy-title" className="section-title">
            Für Bitunix
          </h2>
          <p className="bitunix__note">Kopierwerte abgerundet, Punkt als Dezimalzeichen</p>
        </div>
        <dl className="bitunix__grid">
          <CopyColumn
            setting="By Qty – USD"
            label="Positionswert USD"
            exact={usd(e.positionUsd)}
            copyValue={toCopyValue(e.positionUsd, COPY_DECIMALS.positionUsd)}
          />
          <CopyColumn
            setting="By Position Size – BTC"
            label="Positionswert BTC"
            exact={btc(e.positionBtc)}
            copyValue={toCopyValue(e.positionBtc, COPY_DECIMALS.positionBtc)}
            recommended
          />
          <CopyColumn
            setting="By Cost – BTC"
            label={`Margin bei ${leverage}×`}
            exact={account === "btc" ? btc(e.marginBtc) : `${btc(e.marginBtc)} ≈ ${usdt(e.marginUsdt)} zum Entry`}
            copyValue={toCopyValue(e.marginBtc, COPY_DECIMALS.marginBtc)}
          />
        </dl>
      </section>

      <dl className="kpis">
        <div className="card kpi">
          <dt className="kpi__label">Risiko effektiv</dt>
          <dd className="kpi__value">{pct(e.riskPctEffective)}</dd>
          <dd className="kpi__sub">Limit {inAccountUnit(e.riskLimit)}</dd>
        </div>
        <div className="card kpi">
          <dt className="kpi__label">Stop-Abstand</dt>
          <dd className="kpi__value kpi__value--risk">{pct(e.stopDistancePct)}</dd>
          <dd className="kpi__sub">vom Entry</dd>
        </div>
        <div className="card kpi">
          <dt className="kpi__label">Liq-Faktor</dt>
          <dd className="kpi__value factor" data-status={e.liq.status}>
            {factor(e.liq.factor)}
          </dd>
          <dd className="kpi__sub">Liq-Abstand ÷ Stop-Abstand</dd>
        </div>
        <div className="card kpi">
          <dt className="kpi__label">CRV · Basis {crvBasis === "btc" ? "BTC" : "USD"}</dt>
          <dd className="kpi__value kpi__value--accent">{e.crv === null ? "–" : `${formatDe(e.crv, 2)} R`}</dd>
          <dd className="kpi__sub">{e.gainBtc === null ? "ohne TP" : `Gewinn ${btc(e.gainBtc)}`}</dd>
        </div>
      </dl>

      <div className="details">
        <section className="card" aria-labelledby="risk-title">
          <h2 id="risk-title" className="section-title details__title">
            Risiko
          </h2>
          <dl>
            {account === "btc" ? (
              <>
                <ResultRow label="Risiko BTC netto" hint="Basis der Positionsgröße" value={btc(e.riskBtc)} />
                <ResultRow label="Risiko BTC brutto" hint="inkl. Gebühren/Slippage" value={btc(e.grossRiskBtc)} />
                <ResultRow label="Verlust bei Stop" hint="netto, bewertet zum Stop-Kurs" value={usdt(e.lossAtStopUsdt)} />
              </>
            ) : (
              <>
                <ResultRow
                  label="Risiko USDT netto"
                  hint="Basis der Positionsgröße, Verlust bewertet zum Stop-Kurs"
                  value={usdt(e.lossAtStopUsdt)}
                />
                <ResultRow label="Risiko USDT brutto" hint="inkl. Gebühren/Slippage" value={usdt(e.grossRisk)} />
                <ResultRow label="Risiko BTC netto" hint="Risiko USDT ÷ Stop-Kurs" value={btc(e.riskBtc)} />
              </>
            )}
            <ResultRow label="Gewinn bei TP" value={e.gainBtc === null ? "–" : btc(e.gainBtc)} />
            <ResultRow
              label="Gewinn bei TP in USDT"
              hint="bewertet zum TP-Kurs"
              value={e.gainAtTpUsdt === null ? "–" : usdt(e.gainAtTpUsdt)}
            />
          </dl>
          <p className="details__note">
            USDT-Werte: Gewinn/Verlust der Position, bewertet zum Stop- bzw. TP-Kurs. Die Kursänderung der
            BTC-Sicherheit selbst ist nicht enthalten – das ist nicht die gesamte Kontoveränderung in USD.
          </p>
        </section>

        <section className="card" aria-labelledby="liq-title">
          <h2 id="liq-title" className="section-title details__title">
            Liquidation &amp; Kontrolle
          </h2>
          <dl>
            <ResultRow
              label="Liquidationspreis"
              hint={direction === "short" ? TEXT_SHORT_LIQ_NOTE : "Näherung für Isolated-Margin"}
              value={price(e.liq.price)}
            />
            {e.panelLiq !== null && (
              <ResultRow label="Liq laut Bitunix-Panel" hint="maßgeblich" value={price(e.panelLiq.price)} />
            )}
            <ResultRow
              label="Effektiver Hebel aufs Konto"
              hint={account === "btc" ? "Positionswert BTC ÷ Kontostand" : "Positionswert USD ÷ Kontostand USDT"}
              value={`${formatDe(e.effectiveLeverage, 2)}×`}
            />
            <ResultRow
              label="Näherung zur Kontrolle"
              hint="Positionswert USD, linear"
              value={usd(e.approxPositionUsd)}
            />
          </dl>
        </section>
      </div>

      <TakeProfits evaluation={e} />

      <JournalExport evaluation={e} />
    </div>
  );
}
