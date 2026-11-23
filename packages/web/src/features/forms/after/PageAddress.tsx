import { useEffect, useId, useState } from "react";
import type { FieldPath, SearchHit } from "@galley/core/types";
import { useFormValue } from "@/features/content/form/context";
import { api } from "@/lib/api";
import { Field, Input } from "@/ui";
import { settingText } from "../logic/json";
import { useEdits } from "../file/hooks";

function usePageSearch(siteId: string, text: string): SearchHit[] {
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const q = text.trim().replace(/^\/+|\/+$/g, "");
    if (q.length < 2 || /^https?:/i.test(q)) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api("GET /api/sites/:siteId/search", { params: { siteId }, query: { q, limit: 12 }, signal: controller.signal })
        .then((found) => setHits(found.filter((hit) => hit.url)))
        .catch(() => setHits([]));
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [siteId, text]);
  return hits;
}

/** A page address: type a path, or a word to find one of the site's pages. */
export function PageAddress({ siteId, path, label, hint }: { siteId: string; path: FieldPath; label: string; hint?: string }) {
  const edits = useEdits();
  const value = settingText(useFormValue(path));
  const hits = usePageSearch(siteId, value);
  const listId = useId();
  const pages = hits.filter((hit, index) => hits.findIndex((other) => other.url === hit.url) === index);
  const looksWrong = value && !value.startsWith("/") && !/^https?:\/\//i.test(value) && pages.length === 0;
  return (
    <Field label={label} hint={looksWrong ? undefined : (hint ?? "A page on this site (/thanks/), or a full address.")} error={looksWrong ? "Start with / for a page on this site, or https:// for another site." : null}>
      <Input value={value} list={listId} mono placeholder="/thanks/" onChange={(event) => edits.type(path, event.target.value, true)} onBlur={() => edits.commit(path)} />
      <datalist id={listId}>
        {pages.map((hit) => (
          <option key={hit.url} value={hit.url ?? ""}>
            {hit.title}
          </option>
        ))}
      </datalist>
    </Field>
  );
}
