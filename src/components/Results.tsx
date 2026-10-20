import { TEXT_SHORT_LIQ_NOTE, type Evaluation, type LiqCheck } from "@/lib/evaluate";
import { COPY_DECIMALS, formatDe, toCopyValue } from "@/lib/format";
import { JournalExport } from "./JournalExport";
import { PriceRail } from "./PriceRail";
import { ResultRow } from "./ResultRow";

const usd = (value: number) => `${formatDe(value, 2)} USD`;
const btc = (value: number) => `${formatDe(value, 8)} BTC`;
const pct = (value: number) => `${formatDe(value, 2)} %`;
const price = (value: number) => (Number.isFinite(value) ? `${formatDe(value, 1)} USD` : "keine Liquidation");
const factor = (value: number) => (Number.isFinite(value) ? `${formatDe(value, 2)}×` : "∞");

function LiqRows({ check, label, hint }: { check: LiqCheck; label: string; hint: string }) {
  return (
    <>
      <ResultRow label={label} hint={hint} value={price(check.price)} />
      <ResultRow label="Liq-Abstand" value={check.distancePct === null ? "–" : pct(check.distancePct)} />
      <ResultRow
        label="Faktor"
        hint="Liq-Abstand ÷ Stop-Abstand"
        value={<span data-status={check.status}>{factor(check.factor)}</span>}
      />
    </>
  );
}

export function Results({ evaluation: e }: { evaluation: Evaluation }) {
  const { direction, entry, stop, tp, leverage } = e.inputs;
  return (
    <div className="results">
      <section className="panel panel--rail" aria-labelledby="rail-title">
        <h2 id="rail-title" className="section-title">
          Preisleiste
        </h2>
        <PriceRail entry={entry} stop={stop} tp={tp} liq={e.liq} panelLiq={e.panelLiq} />
      </section>

      <section className="panel panel--copy" aria-labelledby="copy-title">
        <h2 id="copy-title" className="section-title">
          Für Bitunix
        </h2>
        <dl className="results__list">
          <ResultRow
            label="Positionswert USD"
            hint="By Qty – USD"
            value={usd(e.positionUsd)}
            copyValue={toCopyValue(e.positionUsd, COPY_DECIMALS.positionUsd)}
          />
          <ResultRow
            label="Positionswert BTC"
            hint="By Position Size – BTC"
            value={btc(e.positionBtc)}
            copyValue={toCopyValue(e.positionBtc, COPY_DECIMALS.positionBtc)}
          />
          <ResultRow
            label={`Margin bei ${leverage}x`}
            hint="By Cost – BTC"
            value={btc(e.marginBtc)}
            copyValue={toCopyValue(e.marginBtc, COPY_DECIMALS.marginBtc)}
          />
        </dl>
        <p className="panel__note">Kopierwerte sind abgerundet, mit Punkt als Dezimalzeichen.</p>
      </section>

      <div className="results__grid">
        <section className="panel" aria-labelledby="risk-title">
          <h2 id="risk-title" className="section-title">
            Risiko
          </h2>
          <dl className="results__list">
            <ResultRow label="Risiko BTC netto" hint="Basis der Positionsgröße" value={btc(e.riskBtc)} />
            <ResultRow label="Risiko BTC brutto" hint="inkl. Gebühren/Slippage" value={btc(e.grossRiskBtc)} />
            <ResultRow label="Risiko % effektiv" hint={`Limit ${btc(e.riskLimitBtc)}`} value={pct(e.riskPctEffective)} />
            <ResultRow label="Stop-Abstand" value={pct(e.stopDistancePct)} />
          </dl>
        </section>

        <section className="panel" aria-labelledby="liq-title">
          <h2 id="liq-title" className="section-title">
            Liquidation
          </h2>
          <dl className="results__list">
            <LiqRows
              check={e.liq}
              label="Liquidationspreis"
              hint={direction === "short" ? TEXT_SHORT_LIQ_NOTE : "Näherung für Isolated-Margin"}
            />
            {e.panelLiq !== null && (
              <LiqRows check={e.panelLiq} label="Liq laut Bitunix-Panel" hint="maßgeblich" />
            )}
          </dl>
        </section>

        <section className="panel" aria-labelledby="target-title">
          <h2 id="target-title" className="section-title">
            Ziel
          </h2>
          <dl className="results__list">
            <ResultRow label="Gewinn bei TP" value={e.gainBtc === null ? "–" : btc(e.gainBtc)} />
            <ResultRow label="CRV" value={e.crv === null ? "–" : `${formatDe(e.crv, 2)} R`} />
          </dl>
        </section>

        <section className="panel" aria-labelledby="check-title">
          <h2 id="check-title" className="section-title">
            Kontrolle
          </h2>
          <dl className="results__list">
            <ResultRow
              label="Effektiver Hebel aufs Konto"
              hint="Positionswert BTC ÷ Kontostand"
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

      <JournalExport evaluation={e} />
    </div>
  );
}
