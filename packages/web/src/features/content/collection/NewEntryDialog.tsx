import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Collection, Entry, EntryTemplate, Field as FieldDef, JsonValue } from "@galley/core/types";
import { api, errorShape, isApiFailure, rawFileUrl } from "@/lib/api";
import { useSite } from "@/lib/stores/site";
import { Button, Dialog, ErrorState, Field, Input, Select, Textarea, Toggle } from "@/ui";
import { TagInput } from "@/ui/form/TagInput";
import { MediaPicker } from "@/features/media/MediaPicker";
import { placeholderFor } from "../fields/common";
import { emptyValue } from "../form/scaffold";
import { cleanSlugInput, newEntryBody, slugProblem, suggestSlug, urlForSlug } from "./slug";

export interface NewEntryDialogProps {
  siteId: string;
  collection: Collection;
  open: boolean;
  onClose: () => void;
  onCreated: (entry: Entry) => void;
}

/** Types simple enough to ask for up front; the rest are filled in the form afterwards. */
const ASKABLE = new Set(["string", "text", "markdown", "url", "date", "datetime", "select", "number", "boolean", "image", "tags", "reference", "color"]);

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function startValue(field: FieldDef): JsonValue {
  if (field.type === "date") return today();
  if (field.type === "datetime") return `${today()}T09:00`;
  return emptyValue(field);
}

/** The title field: the collection's own, else its first required one-line field. */
function titleFieldOf(collection: Collection): FieldDef | undefined {
  return collection.fields.find((field) => field.key === collection.titleField) ?? collection.fields.find((field) => field.required && field.type === "string");
}

function RequiredControl({ field, value, onChange, siteId }: { field: FieldDef; value: JsonValue; onChange: (value: JsonValue) => void; siteId: string }) {
  const [picking, setPicking] = useState(false);
  const text = typeof value === "string" ? value : value === null ? "" : String(value);
  switch (field.type) {
    case "text":
    case "markdown":
      return <Textarea value={text} rows={2} onChange={(event) => onChange(event.target.value)} />;
    case "date":
      return <Input type="date" value={text} onChange={(event) => onChange(event.target.value)} />;
    case "datetime":
      return <Input type="datetime-local" value={text} onChange={(event) => onChange(event.target.value)} />;
    case "number":
      return <Input inputMode="decimal" value={text} onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))} />;
    case "boolean":
      return <Toggle checked={value === true} onChange={onChange} />;
    case "select":
      return <Select value={text} placeholder="Choose…" options={(field.options ?? []).map((option) => ({ value: option, label: option }))} onChange={onChange} />;
    case "tags":
      return (
        <TagInput
          tags={Array.isArray(value) ? value.map(String) : []}
          suggestions={field.options}
          onAdd={(tag) => onChange([...(Array.isArray(value) ? value : []), tag])}
          onRemove={(index) => onChange((Array.isArray(value) ? value : []).filter((_, at) => at !== index))}
        />
      );
    case "image":
      return (
        <span className="app-url">
          <Input mono value={text} placeholder="/images/…" onChange={(event) => onChange(event.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            Choose…
          </Button>
          <MediaPicker siteId={siteId} open={picking} onClose={() => setPicking(false)} onPick={(url) => onChange(url)} />
        </span>
      );
    default:
      return <Input value={text} placeholder={placeholderFor(field)} onChange={(event) => onChange(event.target.value)} />;
  }
}

const NO_TEMPLATES: EntryTemplate[] = [];

/**
 * "Start from": a blank entry, or one of the ready-made pages the site's
 * galley.config.json declares for this collection (`templates`). Native
 * radios, so arrow keys move between them and the choice is announced.
 */
function StartFrom({ siteId, templates, value, onChange }: { siteId: string; templates: EntryTemplate[]; value: string; onChange: (id: string) => void }) {
  const options = [{ id: "", label: "Blank", description: "Only what you fill in here." } as Pick<EntryTemplate, "id" | "label" | "description" | "thumbnail">, ...templates];
  return (
    <fieldset className="app-start">
      <legend className="g-label">Start from</legend>
      <div className="app-start__list">
        {options.map((option) => (
          <label key={option.id || "blank"} className={value === option.id ? "app-start__option app-start__option--on" : "app-start__option"}>
            <input type="radio" name="new-entry-start" value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
            <span className="app-start__thumb" aria-hidden="true">
              {option.thumbnail ? <img src={rawFileUrl(siteId, option.thumbnail)} alt="" loading="lazy" /> : null}
            </span>
            <span className="app-start__text">
              <span className="app-start__label">{option.label}</span>
              {option.description ? <span className="app-start__description">{option.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "New post": where it starts from (blank or a template), the title, the address it will have (editable), and any other required fields. */
export function NewEntryDialog({ siteId, collection, open, onClose, onCreated }: NewEntryDialogProps) {
  const titleField = useMemo(() => titleFieldOf(collection), [collection]);
  const asked = useMemo(() => collection.fields.filter((field) => field.required && !field.hidden && field.key !== titleField?.key && ASKABLE.has(field.type)), [collection, titleField]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [values, setValues] = useState<Record<string, JsonValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [slugTaken, setSlugTaken] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const allTemplates = useSite((s) => s.detail?.model.templates) ?? NO_TEMPLATES;
  const templates = useMemo(() => allTemplates.filter((template) => template.collection === collection.id), [allTemplates, collection.id]);
  const [template, setTemplate] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setSlug("");
    setSlugEdited(false);
    setValues(Object.fromEntries(asked.map((field) => [field.key, startValue(field)])));
    setError(null);
    setSlugTaken(null);
    setTried(false);
    setTemplate("");
  }, [open, asked]);

  const shownSlug = slugEdited ? slug : suggestSlug(title);
  const problem = slugProblem(shownSlug);
  const url = urlForSlug(collection.url, shownSlug);
  const prefix = collection.url ? collection.url.split("{slug}")[0] ?? "/" : `${collection.path}/`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!title.trim() || problem) return;
    setBusy(true);
    setError(null);
    setSlugTaken(null);
    try {
      const entry = await api("POST /api/sites/:siteId/entries", {
        params: { siteId },
        body: newEntryBody({ collection, slug: shownSlug, title, titleKey: titleField?.key, values, template }),
      });
      onCreated(entry);
    } catch (caught) {
      if (isApiFailure(caught) && caught.shape.code === "conflict") setSlugTaken(caught.shape.message);
      else setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const singular = collection.singular;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`New ${singular}`}
      size="md"
      initialFocus={titleInput}
      dismissible={!busy}
      className="app-new-entry"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button variant="primary" type="submit" form="new-entry-form" busy={busy} busyLabel="Creating">
            Create {singular}
          </Button>
        </>
      }
    >
      <form id="new-entry-form" className="app-form-stack" onSubmit={(event) => void submit(event)} noValidate>
        {templates.length > 0 ? <StartFrom siteId={siteId} templates={templates} value={template} onChange={setTemplate} /> : null}
        <Field label={titleField?.label ?? "Title"} error={tried && !title.trim() ? `Give the ${singular} a ${(titleField?.label ?? "title").toLowerCase()}.` : undefined}>
          <Input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={titleField ? placeholderFor(titleField) : undefined} />
        </Field>
        <Field
          label="Address"
          hint={url ? `It will be at ${url}` : `Saved as ${shownSlug || "…"} in ${collection.label}`}
          error={slugTaken ? `${slugTaken}` : tried || slugEdited ? (problem ?? undefined) : undefined}
        >
          <span className="app-slug">
            <span className="app-slug__prefix" aria-hidden="true">
              {prefix}
            </span>
            <Input
              mono
              value={shownSlug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlugTaken(null);
                setSlug(cleanSlugInput(event.target.value));
              }}
            />
          </span>
        </Field>
        {(template ? [] : asked).map((field) => (
          <Field key={field.key} label={field.label} fieldKey={field.key} hint={field.description}>
            <RequiredControl field={field} siteId={siteId} value={values[field.key] ?? null} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} />
          </Field>
        ))}
        {error ? <ErrorState compact title={`Couldn’t create the ${singular}`} error={error} message={`${errorShape(error).message} Nothing was added.`} /> : null}
      </form>
    </Dialog>
  );
}
