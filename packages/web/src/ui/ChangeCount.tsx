import { plural } from "@/lib/format";
import { ProofMark } from "./ProofMark";

export interface ChangeCountProps {
  /** Lines (or items) added — caret. */
  additions?: number;
  /** Lines (or items) removed — dele. */
  deletions?: number;
  /** Items changed or moved — transpose. */
  changes?: number;
  /** Unit for screen readers, singular: "line" (default) or e.g. "field" — "1 line added", "3 lines added". */
  unit?: string;
  className?: string;
}

/** The proof tally: "‸4 ꝺ2" — counts that carry their marks, as in the specimen's file rows. */
export function ChangeCount({ additions = 0, deletions = 0, changes = 0, unit = "line", className }: ChangeCountProps) {
  const words = (n: number) => (n === 1 ? unit : plural(unit));
  return (
    <span className={className ? `g-tally ${className}` : "g-tally"}>
      {additions > 0 ? (
        <span className="g-tally__ins">
          <ProofMark kind="caret" />
          {additions}
          <span className="g-sr"> {words(additions)} added</span>
        </span>
      ) : null}
      {deletions > 0 ? (
        <span className="g-tally__del">
          <ProofMark kind="dele" />
          {deletions}
          <span className="g-sr"> {words(deletions)} removed</span>
        </span>
      ) : null}
      {changes > 0 ? (
        <span className="g-tally__chg">
          <ProofMark kind="transpose" />
          {changes}
          <span className="g-sr"> {words(changes)} changed</span>
        </span>
      ) : null}
    </span>
  );
}
