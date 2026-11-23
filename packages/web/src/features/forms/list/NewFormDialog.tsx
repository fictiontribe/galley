import { useEffect, useState } from "react";
import type { Collection } from "@galley/core/types";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { storeWrittenEntry } from "@/lib/entryWrites";
import { keys } from "@/lib/sync";
import { Button, Dialog, Field, Input, cx } from "@/ui";
import { toJson, type JsonObject } from "../logic/json";
import { cleanFormId } from "../logic/locate";
import { FORM_STARTERS, type FormStarter } from "../logic/starters";

export interface NewFormDialogProps {
  siteId: string;
  collection: Collection;
  open: boolean;
  onClose: () => void;
  /** Ids already used, so the suggestion is free. */
  taken: readonly string[];
  onCreated: (formId: string) => void;
}

function freeId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

/** "New form": start blank or from a starting point, name it, and it opens in the builder. */
export function NewFormDialog({ siteId, collection, open, onClose, taken, onCreated }: NewFormDialogProps) {
  const [starter, setStarter] = useState<FormStarter>(FORM_STARTERS[0] as FormStarter);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = FORM_STARTERS[0] as FormStarter;
    setStarter(first);
    setName(first.form.name);
    setId(freeId(first.suggestedId, taken));
    setIdTouched(false);
    setError(null);
  }, [open]);

  const pick = (next: FormStarter) => {
    setStarter(next);
    setName(next.form.name);
    if (!idTouched) setId(freeId(next.suggestedId, taken));
  };
  const clean = cleanFormId(id);
  const clash = taken.includes(clean);
  const create = async () => {
    if (!clean || clash) return;
    setBusy(true);
    setError(null);
    try {
      const data = toJson({ ...structuredClone(starter.form), name: name.trim() || starter.form.name }) as JsonObject;
      const entry = await api("POST /api/sites/:siteId/entries", { params: { siteId }, body: { collection: collection.id, slug: clean, data } });
      storeWrittenEntry(siteId, entry);
      invalidate(keys.entries(siteId, collection.id));
      onCreated(clean);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The form couldn’t be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New form"
      description="Start from scratch or from a common form. Every part can be changed afterwards."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Creating…" disabled={!clean || clash} onClick={() => void create()}>
            Create form
          </Button>
        </>
      }
    >
      <div className="kit-starters" role="radiogroup" aria-label="Start from">
        {FORM_STARTERS.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={item.id === starter.id} className={cx("kit-starter", item.id === starter.id && "kit-starter--checked")} onClick={() => pick(item)}>
            <span className="kit-starter__name">{item.label}</span>
            <span className="kit-starter__description">{item.description}</span>
            <span className="kit-starter__count">{item.form.fields.length} {item.form.fields.length === 1 ? "field" : "fields"}</span>
          </button>
        ))}
      </div>
      <div className="app-form-row">
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!idTouched) setId(freeId(cleanFormId(event.target.value) || starter.suggestedId, taken));
            }}
          />
        </Field>
        <Field label="Form id" hint={clash ? undefined : "How pages refer to it. Lowercase words and hyphens."} error={clash ? "Another form already uses this id." : error}>
          <Input
            mono
            value={id}
            onChange={(event) => {
              setIdTouched(true);
              setId(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-"));
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}
