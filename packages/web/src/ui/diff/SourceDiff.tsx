import type { DiffHunk } from "@galley/core/types";
import { ProofMark } from "../ProofMark";
import { cx } from "../cx";
import { ProofText } from "./ProofText";
import { proofHunk } from "./wordDiff";
import "./diff.css";

export interface SourceDiffProps {
  hunks: DiffHunk[];
  /** Accessible name of the table, e.g. "Lines changed in index.md". */
  label: string;
  className?: string;
}

function range(start: number, lines: number): string {
  if (lines <= 1) return `Line ${start}`;
  return `Lines ${start}–${start + lines - 1}`;
}

/** A file's changed lines with numbers, proof-marked: carets on what was added, strikes on what was removed. */
export function SourceDiff({ hunks, label, className }: SourceDiffProps) {
  return (
    <div className={cx("ui-source", className)}>
      {hunks.map((hunk, index) => (
        <table key={index} className="ui-source__hunk">
          <caption className="ui-source__head">
            <span className="g-eyebrow">{range(hunk.newStart || hunk.oldStart, Math.max(hunk.newLines, 1))}</span>
            <span className="g-sr">{` of ${label}`}</span>
          </caption>
          <colgroup>
            <col className="ui-source__col-num" />
            <col className="ui-source__col-num" />
            <col className="ui-source__col-mark" />
            <col />
          </colgroup>
          <thead className="g-sr">
            <tr>
              <th scope="col">Before</th>
              <th scope="col">After</th>
              <th scope="col">Change</th>
              <th scope="col">Text</th>
            </tr>
          </thead>
          <tbody>
            {proofHunk(hunk).map(({ line, parts }, row) => (
              <tr key={row} className={cx("ui-source__row", line.type !== "context" && `ui-source__row--${line.type}`)}>
                <td className="ui-source__num">{line.oldNumber ?? ""}</td>
                <td className="ui-source__num">{line.newNumber ?? ""}</td>
                <td className="ui-source__mark">
                  {line.type === "add" ? <ProofMark kind="caret" tone="insert" label="Added line" /> : null}
                  {line.type === "del" ? <ProofMark kind="dele" tone="delete" label="Removed line" /> : null}
                </td>
                <td className="ui-source__text">
                  {parts ? (
                    <ProofText parts={parts} plain />
                  ) : line.type === "context" ? (
                    line.text || " "
                  ) : (
                    <ProofText parts={[{ kind: line.type === "add" ? "ins" : "del", text: line.text || " " }]} plain />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
