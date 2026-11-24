/**
 * Proof's "In the bucket": files put in the site's bucket (or Cloudflare
 * Images) since the last publish. They aren't in any commit and can't be
 * discarded — they are public at their addresses already — so each says
 * whether a page uses it, and the unused ones can be removed for good.
 */
import { useState } from "react";
import type { MediaItem } from "@galley/core/types";
import { errorShape, rawFileUrl } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useMay } from "@/lib/may";
import { useChanges } from "@/lib/stores/changes";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button } from "@/ui";
import { deleteStored } from "@/features/media/storage/useMediaStorage";

export function StoreUploads({ siteId, items }: { siteId: string; items: MediaItem[] }) {
  const may = useMay()("POST /api/sites/:siteId/media/storage/delete");
  const refresh = useChanges((s) => s.refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const where = items.some((item) => item.location === "images") ? (items.every((item) => item.location === "images") ? "Cloudflare Images" : "the bucket and Cloudflare Images") : "the bucket";

  const remove = async (item: MediaItem) => {
    setBusy(item.path);
    try {
      const result = await deleteStored(siteId, [item.path]);
      if (result.refused.length) notify({ tone: "warning", title: `${item.name} wasn’t removed`, body: "A page uses it now. Take it out of the page first." });
      else notify({ tone: "neutral", title: `${item.name} removed from ${where}` });
      await refresh();
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t remove the file", body: errorShape(error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="app-card app-card--pad proof-uploads" aria-labelledby="proof-uploads-title">
      <h2 id="proof-uploads-title" className="proof-uploads__title">{`In ${where}`}</h2>
      <p className="proof-uploads__lede">Uploaded since the last publish. They are already public at their addresses, but no published page links to them until you publish the pages that use them. Discarding a page doesn’t remove them.</p>
      <ul className="proof-uploads__list">
        {items.map((item) => (
          <li key={item.path} className="proof-uploads__item">
            {item.type.startsWith("image/") ? <img src={rawFileUrl(siteId, item.path)} alt="" loading="lazy" /> : <span className="proof-uploads__file g-mono">{item.name.split(".").pop()?.toUpperCase()}</span>}
            <span className="proof-uploads__name">{item.name}</span>
            <span className="g-hint">{bytes(item.size)}</span>
            {item.used ? <Badge tone="insert">Used on a page</Badge> : <Badge tone="neutral">Not used by any page</Badge>}
            {!item.used && may ? (
              <Button size="sm" variant="danger-quiet" icon="trash" busy={busy === item.path} onClick={() => void remove(item)}>
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
