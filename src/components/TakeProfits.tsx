import { TP_DECIMALS } from "@/lib/calc";
import type { Evaluation } from "@/lib/evaluate";
import { formatDe, formatDeCompact, toCopyValue } from "@/lib/format";
import type { LadderRow, PartialRow, TpOutcome } from "@/lib/tpPlan";
import { CopyButton } from "./CopyButton";
import { ResultRow } from "./ResultRow";

const btc = (value: number) => `${formatDe(value, 8)} BTC`;
const usdt = (value: number) => `${formatDe(value, 2)} USDT`;
const r = (value: number) => `${formatDeCompact(value, 2)} R`;

/** Copyable TP price on the tick: dot decimal, no grouping. */
function TpPrice({ subject, tp }: { subject: string; tp: number }) {
  const copyValue = toCopyValue(tp, TP_DECIMALS);
  return (
    <span className="tp-copy">
      <code className="tp-copy__value" title="Kopierwert">
        {copyValue}
      </code>
      <CopyButton value={copyValue} subject={subject} />
    </span>
  );
}

/** "+4,63 % · 0,00012345 BTC · 12,34 USDT": distance from entry and the gain at the TP. */
function OutcomeMeta({ outcome }: { outcome: TpOutcome }) {
  return (
    <span className="tp-meta">
      <span>{formatDe(outcome.distancePct, 2)} % vom Entry</span>
      <span>+{btc(outcome.gainBtc)}</span>
      <span>≈ {usdt(outcome.gainUsdt)}</span>
    </span>
  );
}

function Ladder({ rows }: { rows: LadderRow[] }) {
  return (
    <ol className="tp-ladder">
      {rows.map((row) => (
        <li key={row.crv} className="tp-ladder__row">
          <span className="tp-ladder__crv">{r(row.crv)}</span>
          {row.outcome === null ? (
            <span className="tp-ladder__unreachable">nicht erreichbar</span>
          ) : (
            <>
              <TpPrice subject={`TP bei ${r(row.crv)}`} tp={row.outcome.tp} />
              <OutcomeMeta outcome={row.outcome} />
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function Part({ part, index }: { part: PartialRow; index: number }) {
  const name = `TP${index + 1}`;
  const closes = part.sharePct > 0;
  return (
    <li className="tp-part">
      <div className="tp-part__head">
        <span className="tp-part__name">{name}</span>
        <span className="tp-part__meta">
          {r(part.crv)} · {formatDeCompact(part.sharePct, 2)} %
        </span>
      </div>
      <dl className="tp-part__grid">
        <div className="tp-part__item">
          <dt className="tp-part__label">TP-Preis</dt>
          <dd>
            <TpPrice subject={`${name}-Preis`} tp={part.tp} />
            <span className="tp-part__exact">{formatDe(part.distancePct, 2)} % vom Entry</span>
          </dd>
        </div>
        <div className="tp-part__item">
          <dt className="tp-part__label">Menge BTC</dt>
          <dd>
            {part.copyQtyBtc === null ? (
              <span className="tp-part__none">–</span>
            ) : (
              <span className="tp-copy">
                <code className="tp-copy__value" title="Kopierwert">
                  {part.copyQtyBtc}
                </code>
                <CopyButton value={part.copyQtyBtc} subject={`${name}-Menge`} />
              </span>
            )}
            {closes && (
              <span className="tp-part__exact">
                exakt {btc(part.qtyBtc)} · {formatDe(part.qtyUsd, 2)} USD
              </span>
            )}
          </dd>
        </div>
        <div className="tp-part__item">
          <dt className="tp-part__label">Gewinn</dt>
          <dd className="tp-part__gain">
            {closes ? (
              <>
                <span>{btc(part.gainBtc)}</span>
                <span className="tp-part__exact">≈ {usdt(part.gainUsdt)}</span>
              </>
            ) : (
              <span className="tp-part__none">–</span>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function TakeProfits({ evaluation: e }: { evaluation: Evaluation }) {
  const tps = e.takeProfits;
  const basis = e.inputs.crvBasis === "btc" ? "BTC" : "USD";
  return (
    <section className="card tps" aria-labelledby="tps-title">
      <div className="card__head">
        <h2 id="tps-title" className="section-title">
          Take-Profits
        </h2>
        <span className="card__meta">
          {tps.plan === "ladder" ? "CRV-Stufen" : "Teil-TPs"} · CRV-Basis {basis}
        </span>
      </div>
      <p className="tps__note">
        TP-Preise auf dem 0,1-USD-Tick, Mengen abgerundet. Gewinn in USDT bewertet zum jeweiligen TP-Kurs.
      </p>
      {tps.plan === "ladder" ? (
        <Ladder rows={tps.rows} />
      ) : (
        <>
          <ol className="tp-parts">
            {tps.parts.map((part, index) => (
              <Part key={index} part={part} index={index} />
            ))}
          </ol>
          <dl className="tps__totals">
            <ResultRow label="Gesamtgewinn BTC" hint="alle Teil-TPs getroffen" value={btc(tps.totalGainBtc)} />
            <ResultRow label="Gesamtgewinn USDT" hint="bewertet zu den TP-Kursen" value={usdt(tps.totalGainUsdt)} />
            <ResultRow
              label="CRV gewichtet"
              hint={`nach Anteilen, Basis ${basis}`}
              value={`${formatDe(tps.weightedCrv, 2)} R`}
            />
          </dl>
        </>
      )}
    </section>
  );
}
