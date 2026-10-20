"use client";

import { useState } from "react";
import { toJournalRow, type Evaluation } from "@/lib/evaluate";
import { buildJournalTsv } from "@/lib/format";
import { CopyButton } from "./CopyButton";

export function JournalExport({ evaluation }: { evaluation: Evaluation }) {
  const row = toJournalRow(evaluation);
  const [previewTime] = useState(() => new Date());

  return (
    <section className="journal" aria-labelledby="journal-title">
      <div className="journal__head">
        <h2 id="journal-title" className="section-title">
          Journal
        </h2>
        <CopyButton
          value={() => buildJournalTsv(row, new Date())}
          subject="Journal-Zeile"
          label="Journal-Zeile kopieren"
          className="copy__button--wide"
        />
      </div>
      <p className="journal__note">
        Kopfzeile und eine Datenzeile, tabulatorgetrennt – direkt in Excel, Numbers oder Google Sheets einfügen.
        Datum/Zeit ist der Zeitpunkt des Kopierens.
      </p>
      <details className="journal__preview">
        <summary>Vorschau</summary>
        <pre tabIndex={0}>{buildJournalTsv(row, previewTime)}</pre>
      </details>
    </section>
  );
}
