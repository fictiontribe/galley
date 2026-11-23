import { useMemo, useState } from "react";
import type { ScriptsConfig } from "@galley/core/kit";
import { Field, Input } from "@/ui";
import { LOAD_WORDS } from "./logic/entries";
import { loadsAt } from "./logic/loads";
import { normalizePath } from "./logic/match";

/** Pick or type a page address and see which scripts load there, in order, and what each waits for. */
export function WhatLoadsWhere({ config, suggestions }: { config: ScriptsConfig; suggestions: readonly string[] }) {
  const [address, setAddress] = useState("/");
  const result = useMemo(() => loadsAt(config, address || "/"), [config, address]);
  const path = normalizePath(address || "/");
  return (
    <section className="g-block kit-where" aria-labelledby="where-title">
      <header className="g-block__head">
        <h2 id="where-title" className="kit-tab-head__title">
          What loads where
        </h2>
      </header>
      <div className="g-block__body">
        <Field label="Page address">
          <Input mono value={address} onChange={(event) => setAddress(event.target.value)} placeholder="/pricing/" />
        </Field>
        {suggestions.length ? (
          <div className="kit-where__chips">
            {suggestions.map((suggestion) => (
              <button key={suggestion} type="button" className="g-chip" onClick={() => setAddress(suggestion)} aria-pressed={normalizePath(suggestion) === path}>
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <div role="status" aria-live="polite">
          {result.loads.length === 0 ? (
            <p className="g-hint">No scripts load on {path}.</p>
          ) : (
            <ol className="kit-where__list">
              {result.loads.map((item) => (
                <li key={item.index} className="kit-where__item">
                  <span className="kit-where__name">{item.name}</span>
                  <span className="kit-where__facts">
                    {LOAD_WORDS[item.load].label}
                    {item.waitsFor ? ` · ${item.waitsFor}` : " · No agreement needed"}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {result.skipped.length > 0 ? (
            <details className="app-details">
              <summary>
                Not loaded here ({result.skipped.length})
              </summary>
              <ul className="kit-where__skipped">
                {result.skipped.map((item) => (
                  <li key={item.index}>
                    <b>{item.name}</b> <span className="g-muted">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}
