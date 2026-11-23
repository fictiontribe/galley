import { useEffect, useId, useState } from "react";
import type { SearchHit } from "@galley/core/types";
import { api } from "@/lib/api";
import { Icon, IconButton, Input } from "@/ui";
import { useForm } from "../form/context";
import { asText, useBinding } from "./binding";
import { placeholderFor, type FieldProps } from "./common";
import { FieldShell } from "./FieldShell";

const SEARCH_DELAY_MS = 250;

/** Pages whose address or title matches what's typed, for the suggestions list. */
function usePageSuggestions(siteId: string, typed: string, active: boolean): SearchHit[] {
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const query = typed.replace(/^\/+|\/+$/g, "").replace(/[-/]+/g, " ").trim();
    if (!active || /^[a-z]+:/i.test(typed) || query.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api("GET /api/sites/:siteId/search", { params: { siteId }, query: { q: query, limit: 12 }, signal: controller.signal })
        .then((found) => {
          const seen = new Set<string>();
          setHits(found.filter((hit) => hit.url && !seen.has(hit.url) && seen.add(hit.url)).slice(0, 8));
        })
        .catch(() => setHits([]));
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [siteId, typed, active]);
  return hits;
}

/** `url`: an address, with pages of this site suggested and a way to open it. */
export function UrlField({ field, path, showKey }: FieldProps) {
  const { siteId, preview } = useForm();
  const { value, change, commit, focus } = useBinding(field, path);
  const [active, setActive] = useState(false);
  const text = asText(value);
  const hits = usePageSuggestions(siteId, text, active);
  const listId = useId();
  const external = /^https?:\/\//i.test(text);
  const internal = text.startsWith("/") && !text.startsWith("//");

  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <span className="app-url">
        <Input
          value={text}
          list={listId}
          placeholder={placeholderFor(field) ?? "/contact/"}
          onChange={(event) => change(event.target.value)}
          onFocus={() => {
            setActive(true);
            focus();
          }}
          onBlur={() => {
            setActive(false);
            commit();
          }}
        />
        <datalist id={listId}>
          {hits.map((hit) => (
            <option key={hit.url} value={hit.url ?? ""}>
              {hit.title}
            </option>
          ))}
        </datalist>
        {external ? (
          <a className="g-btn g-btn--quiet g-btn--sm g-btn--icon" href={text} target="_blank" rel="noreferrer noopener" aria-label={`Open ${text} in a new tab`} title="Open in a new tab">
            <Icon name="external" />
          </a>
        ) : internal ? (
          <IconButton icon="eye" label="Show in the preview" onClick={() => preview(text.split("#")[0] ?? text)} />
        ) : null}
      </span>
    </FieldShell>
  );
}
