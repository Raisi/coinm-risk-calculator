"use client";

import { useState } from "react";
import { toJournalRow, type Evaluation } from "@/lib/evaluate";
import { buildJournalTsv } from "@/lib/format";
import { CopyButton } from "./CopyButton";

export function JournalExport({ evaluation }: { evaluation: Evaluation }) {
  const row = toJournalRow(evaluation);
  const [previewTime] = useState(() => new Date());

  return (
    <section className="card journal" aria-labelledby="journal-title">
      <div className="journal__head">
        <div className="journal__intro">
          <h2 id="journal-title" className="section-title">
            Journal
          </h2>
          <p className="journal__note">
            Tab-getrennte Kopf- und Datenzeile für Excel, Numbers oder Google Sheets. Datum/Zeit ist der Zeitpunkt des
            Kopierens.
          </p>
        </div>
        <CopyButton
          value={() => buildJournalTsv(row, new Date())}
          subject="Journal-Zeile"
          label="Journal-Zeile kopieren"
          className="copy__button--outline"
        />
      </div>
      <details className="journal__preview">
        <summary>Vorschau</summary>
        <pre tabIndex={0}>{buildJournalTsv(row, previewTime)}</pre>
      </details>
    </section>
  );
}
