import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errorShape } from "@/lib/api";
import { storeWrittenEntry } from "@/lib/entryWrites";
import { useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Button, Field, Popover, Select } from "@/ui";
import { useNameOf } from "@/lib/names";
import { embedSnippet, formSlots, pagesToOffer, sectionFor, slotAdvice, slotsFor, usedOnWords, type FormSlot } from "../logic/embed";
import { FORMS_COLLECTION, formsCollection } from "../logic/locate";

const slotKey = (slot: FormSlot) => `${slot.collection}/${slot.listKey}/${slot.blockType}`;

function AddToPage({ siteId, slots, formId, onDone }: { siteId: string; slots: readonly FormSlot[]; formId: string; onDone: () => void }) {
  const navigate = useNavigate();
  const model = useSite((s) => s.detail?.model);
  const name = useNameOf();
  const [kind, setKind] = useState("");
  // The best kind of section for this form unless the person picks another.
  const slot = slots.find((candidate) => slotKey(candidate) === kind) ?? (slots[0] as FormSlot);
  const pages = useQuery([...keys.entries(siteId, slot.collection), "for-form"], () => api("GET /api/sites/:siteId/entries", { params: { siteId }, query: { collection: slot.collection, limit: 200, sort: "title", order: "asc" } }));
  // Where the form already is: the forms list's own request (the same cache), so "Used on" and this agree.
  const forms = formsCollection(model);
  const list = useQuery([...keys.entries(siteId, forms?.id ?? FORMS_COLLECTION), "forms"], () => api("GET /api/sites/:siteId/forms", { params: { siteId } }));
  const usedOn = list.data?.forms.find((item) => item.id === formId)?.pages ?? [];
  const loading = pages.loading || list.loading;
  // Nothing is offered until both are in (or the forms list has failed): a page that already has the form must never be the one suggested.
  const offered = loading ? [] : pagesToOffer(pages.data?.items ?? [], usedOn);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = offered.some((item) => item.path === path) ? path : (offered[0]?.path ?? "");
  const add = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const entry = await api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: chosen } });
      const items = entry.data[slot.listKey];
      const at = Array.isArray(items) ? items.length : 0;
      const result = await api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path: chosen }, body: { baseHash: entry.hash, ops: [{ op: "insert", path: [slot.listKey], index: at, value: sectionFor(slot, formId) }] } });
      storeWrittenEntry(siteId, result.entry);
      onDone();
      notify({
        tone: "neutral",
        title: `Form added to ${name({ path: chosen, title: entry.title, url: entry.url })}`,
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
  const where = usedOn.length ? (
    <p className="kit-pop__body">
      {usedOnWords(usedOn.map(name))}{" "}
      {usedOn.length === 1 ? (
        <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(usedOn[0]!.path)}`} onClick={onDone}>
          Open the page
        </Link>
      ) : null}
    </p>
  ) : null;
  // Every page that could have it has it already: say where, rather than offer to add it twice.
  if (!loading && offered.length === 0 && usedOn.length > 0) return where;
  return (
    <div className="kit-embed__add">
      {where}
      {slots.length > 1 ? (
        <Field label="Add it as a section">
          <Select value={slotKey(slot)} options={slots.map((candidate) => ({ value: slotKey(candidate), label: `${candidate.blockLabel} (${candidate.collectionLabel})` }))} onChange={(value) => { setKind(value); setPath(""); }} />
        </Field>
      ) : null}
      <Field label={slots.length > 1 ? "On the page" : usedOn.length ? `Add it to another page, as a “${slot.blockLabel}” section` : `Add it as a “${slot.blockLabel}” section to`}>
        <Select value={chosen} options={offered.map((item) => ({ value: item.path, label: name(item) }))} placeholder={loading ? "Loading pages…" : undefined} onChange={setPath} />
      </Field>
      <Button size="sm" variant="primary" busy={busy} busyLabel="Adding…" disabled={!chosen || loading} onClick={() => void add()}>
        Add to page
      </Button>
    </div>
  );
}

/** "Use this form": which sections on this site show a form, adding it to a page, and the snippet for developers. */
export function UseThisForm({ siteId, formId }: { siteId: string; formId: string }) {
  const model = useSite((s) => s.detail?.model);
  const slots = useMemo(() => slotsFor(formSlots(model), formId), [model, formId]);
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
              {slotAdvice(slots, formId)}
            </p>
            <AddToPage siteId={siteId} slots={slots} formId={formId} onDone={() => setOpen(false)} />
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
