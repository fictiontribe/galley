/**
 * Brand check for the Proof screen: the pending changes against the site's
 * brand, as quiet suggestions with their place. Never blocks publishing.
 * Mount it anywhere in Proof: `<BrandCheckNotes siteId={siteId} />`. It
 * renders nothing when the site has no brand or everything is on brand.
 */
import { useEffect, useState } from "react";
import type { BrandCheckItem } from "@galley/core/sitebrand/types";
import { api } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import "./brand.css";

export function BrandCheckNotes({ siteId }: { siteId: string }) {
  const [items, setItems] = useState<BrandCheckItem[]>([]);
  const [tick, setTick] = useState(0);

  useServerEvent("changes.updated", (event) => {
    if (event.siteId === siteId) setTick((n) => n + 1);
  });
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      api("POST /api/sites/:siteId/brand/check", { params: { siteId }, body: {} })
        .then((result) => live && setItems(result.items))
        .catch(() => live && setItems([]));
    }, 400);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [siteId, tick]);
  if (!items.length) return null;
  return (
    <aside className="brand-check" aria-label="Against the brand">
      <span className="g-eyebrow">Against the brand</span>
      <ul>
        {items.slice(0, 12).map((item, index) => (
          <li key={`${item.path}-${item.line ?? 0}-${index}`}>
            {item.kind === "colour" && item.value ? <i className="brand-drift__chip" style={{ background: item.value }} aria-hidden="true" /> : null}
            <span>{item.text}</span>
            <code>
              {item.path.split("/").pop()}
              {item.line ? `:${item.line}` : ""}
            </code>
          </li>
        ))}
      </ul>
    </aside>
  );
}
