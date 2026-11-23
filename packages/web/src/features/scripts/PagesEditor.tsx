import { useState } from "react";
import type { ScriptEntry } from "@galley/core/kit";
import { Button, Field, IconButton, Input, SegmentedControl } from "@/ui";
import { useEdits } from "@/features/forms/file/hooks";
import { pageVerdict, scopeOf, type PageScope } from "./logic/match";

const SCOPES: Array<{ value: PageScope; label: string }> = [
  { value: "everywhere", label: "Every page" },
  { value: "only", label: "Only these" },
  { value: "except", label: "All except" },
];

function Checker({ entry }: { entry: Pick<ScriptEntry, "include" | "exclude"> }) {
  const [address, setAddress] = useState("");
  const verdict = address.trim() ? pageVerdict(entry, address) : null;
  return (
    <Field label="Try an address" hint={verdict ? undefined : "Type a page address to see whether this script loads there."}>
      <Input mono size="sm" placeholder="/pricing/teams/" value={address} onChange={(event) => setAddress(event.target.value)} />
      {verdict ? (
        <p className={verdict.loads ? "kit-verdict kit-verdict--yes" : "kit-verdict kit-verdict--no"} role="status">
          {verdict.loads ? "Loads here" : "Doesn’t load here"}
          {verdict.because ? ` — matches ${verdict.because.pattern}` : verdict.loads ? " — it loads on every page" : " — no pattern matches"}
        </p>
      ) : null}
    </Field>
  );
}

/** Where a script loads: every page, only some, or all but some — with path patterns and a checker. */
export function PagesEditor({ index, entry }: { index: number; entry: ScriptEntry }) {
  const edits = useEdits();
  const stored = scopeOf(entry);
  const [intended, setIntended] = useState<PageScope | null>(null);
  const scope = stored === "everywhere" && intended ? intended : stored;
  const key = scope === "except" ? "exclude" : "include";
  const patterns = (scope === "except" ? entry.exclude : entry.include) ?? [];
  const path = ["scripts", index, key];

  const choose = (next: PageScope) => {
    setIntended(next);
    if (next === scope) return;
    const current = patterns.filter((pattern) => pattern.trim());
    if (next === "everywhere") {
      edits.apply(...(entry.include ? [{ op: "unset" as const, path: ["scripts", index, "include"] }] : []), ...(entry.exclude ? [{ op: "unset" as const, path: ["scripts", index, "exclude"] }] : []));
      return;
    }
    if (current.length === 0) return;
    const to = next === "except" ? "exclude" : "include";
    edits.apply({ op: "unset", path: ["scripts", index, key] }, { op: "set", path: ["scripts", index, to], value: current });
  };
  const shown = patterns.length > 0 ? patterns : scope === "everywhere" ? [] : [""];

  return (
    <div className="kit-insp__group">
      <Field label="Pages" group>
        <SegmentedControl label="Pages" options={SCOPES} value={scope} onChange={choose} />
      </Field>
      {scope !== "everywhere" ? (
        <Field label={scope === "only" ? "Load only on" : "Don’t load on"} group hint="A page address per line. * stands for one part of the address (/blog/*), ** for any number (/docs/**).">
          <ul className="kit-patterns">
            {shown.map((pattern, at) => (
              <li key={at} className="kit-pattern">
                <Input
                  mono
                  size="sm"
                  aria-label={`Page pattern ${at + 1}`}
                  placeholder="/pricing/*"
                  value={pattern}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (patterns.length === 0) edits.type(path, value ? [value] : undefined);
                    else edits.type([...path, at], value, true);
                  }}
                  onBlur={(event) => {
                    // An address left empty would mean "the home page"; take it out instead.
                    if (event.target.value.trim() === "" && patterns.length > 0) {
                      edits.apply(patterns.length === 1 ? { op: "unset", path } : { op: "remove", path, index: at });
                      return;
                    }
                    edits.commit(path);
                    edits.commit([...path, at]);
                  }}
                />
                {patterns.length > 0 ? (
                  <IconButton
                    icon="close"
                    label={`Remove ${pattern || "pattern"}`}
                    onClick={() => edits.apply(patterns.length === 1 ? { op: "unset", path } : { op: "remove", path, index: at })}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {patterns.length > 0 ? (
            <Button size="sm" variant="secondary" icon="plus" onClick={() => edits.apply({ op: "insert", path, index: patterns.length, value: "" })}>
              Add an address
            </Button>
          ) : null}
        </Field>
      ) : null}
      <Checker entry={entry} />
    </div>
  );
}
