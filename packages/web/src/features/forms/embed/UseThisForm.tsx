import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorShape } from "@/lib/api";
import { storeWrittenEntry } from "@/lib/entryWrites";
import { useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Button, Field, Popover, Select } from "@/ui";
import { embedSnippet, formSlots, sectionFor, type FormSlot } from "../logic/embed";

function AddToPage({ siteId, slot, formId, onDone }: { siteId: string; slot: FormSlot; formId: string; onDone: () => void }) {
  const navigate = useNavigate();
  const pages = useQuery([...keys.entries(siteId, slot.collection), "for-form"], () => api("GET /api/sites/:siteId/entries", { params: { siteId }, query: { collection: slot.collection, limit: 200, sort: "title", order: "asc" } }));
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = path || pages.data?.items[0]?.path || "";
  const add = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const entry = await api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: chosen } });
      const list = entry.data[slot.listKey];
      const at = Array.isArray(list) ? list.length : 0;
      const result = await api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path: chosen }, body: { baseHash: entry.hash, ops: [{ op: "insert", path: [slot.listKey], index: at, value: sectionFor(slot, formId) }] } });
      storeWrittenEntry(siteId, result.entry);
      onDone();
      notify({
        tone: "neutral",
        title: `Form added to ${entry.title}`,
        body: `It’s the last ${slot.blockLabel.toLowerCase()} section on the page. Move it in the editor.`,
        action: { label: "Open the page", onClick: () => navigate(`/sites/${siteId}/edit?path=${encodeURIComponent(chosen)}`) },
        duration: 10000,
      });
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t add the form to the page", body: errorShape(error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kit-embed__add">
      <Field label={`Add it as a “${slot.blockLabel}” section to`}>
        <Select value={chosen} options={(pages.data?.items ?? []).map((item) => ({ value: item.path, label: item.title }))} placeholder={pages.loading ? "Loading pages…" : undefined} onChange={setPath} />
      </Field>
      <Button size="sm" variant="primary" busy={busy} busyLabel="Adding…" disabled={!chosen} onClick={() => void add()}>
        Add to page
      </Button>
    </div>
  );
}

/** "Use this form": which sections on this site show a form, adding it to a page, and the snippet for developers. */
export function UseThisForm({ siteId, formId }: { siteId: string; formId: string }) {
  const model = useSite((s) => s.detail?.model);
  const slots = useMemo(() => formSlots(model), [model]);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const snippet = embedSnippet(formId);
  const copy = () => {
    void navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <>
      <Button ref={anchor} size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
        Use this form
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement="bottom-end" aria-label="Use this form" className="kit-pop kit-embed">
        <p className="kit-pop__title">Put this form on a page</p>
        {slots.length > 0 ? (
          <>
            <p className="kit-pop__body">
              {slots.length === 1 ? "One kind of section on this site shows a form:" : "These sections on this site show a form:"} {slots.map((slot) => `${slot.blockLabel} (${slot.collectionLabel})`).join(", ")}.
            </p>
            <AddToPage siteId={siteId} slot={slots[0] as FormSlot} formId={formId} onDone={() => setOpen(false)} />
          </>
        ) : (
          <p className="kit-pop__body">No section on this site shows a form yet. A developer adds one once, with the snippet below; then you can add forms to pages here.</p>
        )}
        <details className="app-details kit-embed__dev">
          <summary>For developers</summary>
          <pre className="kit-embed__code">
            <code>{snippet}</code>
          </pre>
          <Button size="sm" variant="quiet" icon="copy" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </details>
      </Popover>
    </>
  );
}
