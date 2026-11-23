/**
 * No brand yet: what it is for, and the two ways in. "Read it from this
 * site" comes first when the site has pages; "Set it up from your material"
 * is a drop zone for as many files as needed, each with a note.
 */
import { useId, useRef, useState, type DragEvent } from "react";
import type { BrandSource, SiteBrandState } from "@galley/core/sitebrand/types";
import { api, isApiFailure } from "@/lib/api";
import { notify } from "@/lib/stores/toasts";
import { Button, Icon, Input, Tag } from "@/ui";
import { guessKind, uploadSource } from "./upload";
import { bytes, plan, TYPE_WORDS } from "./words";

interface Pending {
  key: string;
  file: File;
  note: string;
  progress: number | null;
  error: string | null;
}

export function SourceDrop({ siteId, onAdded, compact }: { siteId: string; onAdded: (source: BrandSource) => void; compact?: boolean }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  const add = (files: FileList | File[]) => {
    const list = [...files].map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, note: "", progress: null, error: guessKind(file) ? null : "This kind of file can't be read here." }));

    setPending((current) => [...current, ...list]);
  };
  const update = (key: string, patch: Partial<Pending>) => setPending((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const send = async () => {
    for (const item of pending) {
      if (item.error || item.progress === 1) continue;
      update(item.key, { progress: 0 });
      try {
        const source = await uploadSource(siteId, item.file, item.note, (fraction) => update(item.key, { progress: fraction }));

        onAdded(source);
        setPending((current) => current.filter((p) => p.key !== item.key));
      } catch (error) {
        update(item.key, { progress: null, error: isApiFailure(error) ? error.shape.message : "That file couldn't be added. Try again." });
      }
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (event.dataTransfer.files.length) add(event.dataTransfer.files);
  };
  const ready = pending.filter((p) => !p.error && p.progress === null).length;

  return (
    <div className="brand-drop-wrap">
      <div
        className={`brand-drop${over ? " brand-drop--over" : ""}${compact ? " brand-drop--compact" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Icon name="upload" />
        <p className="brand-drop__text" id={hint}>
          Drop guidelines, logos, screenshots, photos or notes here — as many as you like.
        </p>
        <Button size="sm" variant="secondary" onClick={() => input.current?.click()} aria-describedby={hint}>
          Choose files…
        </Button>
        <input ref={input} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.md,.txt,application/pdf,image/*,text/plain,text/markdown" onChange={(event) => event.target.files && add(event.target.files)} />
      </div>
      {pending.length ? (
        <ul className="brand-pending" aria-label="Files to add">
          {pending.map((item) => {
            const kind = guessKind(item.file);

            return (
              <li key={item.key} className="brand-pending__item">
                <div className="brand-pending__head">
                  <Tag variant="outline">{kind ? TYPE_WORDS[kind] : "Unknown"}</Tag>
                  <span className="brand-pending__name">{item.file.name}</span>
                  <span className="brand-pending__size">{bytes(item.file.size)}</span>
                  <button type="button" className="app-link-button brand-pending__remove" onClick={() => setPending((current) => current.filter((p) => p.key !== item.key))} aria-label={`Remove ${item.file.name}`}>
                    Remove
                  </button>
                </div>
                <p className={`brand-pending__plan${item.error ? " brand-pending__plan--error" : ""}`}>{item.error ?? (kind ? plan({ type: kind }) : "")}</p>
                {!item.error ? (
                  <Input size="sm" value={item.note} onChange={(event) => update(item.key, { note: event.target.value })} placeholder="A note, such as “old logo, do not use”" aria-label={`Note about ${item.file.name}`} maxLength={300} disabled={item.progress !== null} />
                ) : null}
                {item.progress !== null ? <progress className="brand-progress" value={item.progress} max={1} aria-label={`Adding ${item.file.name}`} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {ready ? (
        <div className="brand-pending__actions">
          <Button variant="primary" onClick={() => void send()}>
            {ready === 1 ? "Add 1 file" : `Add ${ready} files`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function WebsiteField({ siteId, onAdded }: { siteId: string; onAdded: (source: BrandSource) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  return (
    <form
      className="brand-website"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!url.trim()) return;
        setBusy(true);
        setError(null);
        try {
          onAdded(await api("POST /api/sites/:siteId/brand/website", { params: { siteId }, body: { url: url.trim() } }));
          setUrl("");
        } catch (caught) {
          setError(isApiFailure(caught) ? caught.shape.message : "That address couldn't be read.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id} className="brand-website__label">
        And an existing website, if there is one
      </label>
      <div className="brand-website__row">
        <Input id={id} size="sm" type="url" inputMode="url" placeholder="https://" value={url} onChange={(event) => setUrl(event.target.value)} aria-invalid={Boolean(error)} />
        <Button size="sm" variant="secondary" type="submit" busy={busy} busyLabel="Reading…">
          Add
        </Button>
      </div>
      {error ? <p className="g-error-text">{error}</p> : null}
    </form>
  );
}

export function SourceList({ siteId, sources, onChange }: { siteId: string; sources: BrandSource[]; onChange: () => void }) {
  if (!sources.length) return null;
  return (
    <ul className="brand-sources" aria-label="Material">
      {sources.map((source) => (
        <li key={source.id} className={`brand-source${source.ignored ? " brand-source--ignored" : ""}`}>
          {source.type === "image" || source.type === "svg" ? (
            <img className="brand-source__thumb" alt="" src={`/api/sites/${encodeURIComponent(siteId)}/brand/sources/${source.id}/file?kind=${source.type === "image" ? "picture" : "original"}`} />
          ) : (
            <span className="brand-source__thumb brand-source__thumb--type" aria-hidden="true">
              {source.type === "pdf" ? "PDF" : source.type === "website" ? "WWW" : "TXT"}
            </span>
          )}
          <div className="brand-source__main">
            <div className="brand-source__head">
              <span className="brand-source__name">{source.name}</span>
              <span className="brand-source__meta">
                {TYPE_WORDS[source.type]} · {bytes(source.bytes)}
                {source.stored === "outside" ? " · kept outside the site" : ""}
              </span>
            </div>
            {source.note ? <p className="brand-source__note">“{source.note}”</p> : null}
            <ul className="brand-source__learned">
              {(source.learned.length ? source.learned : [plan(source)]).slice(0, 4).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {source.limited ? <li className="brand-source__limited">{source.limited}</li> : null}
            </ul>
          </div>
          <div className="brand-source__actions">
            <Button
              size="sm"
              variant="quiet"
              onClick={async () => {
                await api("PATCH /api/sites/:siteId/brand/sources/:sourceId", { params: { siteId, sourceId: source.id }, body: { ignored: !source.ignored } });
                onChange();
              }}
            >
              {source.ignored ? "Use it" : "Leave out"}
            </Button>
            <Button
              size="sm"
              variant="danger-quiet"
              onClick={async () => {
                await api("DELETE /api/sites/:siteId/brand/sources/:sourceId", { params: { siteId, sourceId: source.id } });
                notify({ tone: "neutral", title: `${source.name} removed` });
                onChange();
              }}
            >
              Remove
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Start({ siteId, state, onReadSite, onReadMaterial, onChange }: { siteId: string; state: SiteBrandState; onReadSite: () => void; onReadMaterial: () => void; onChange: () => void }) {
  const fromSite = (
    <section className="brand-way brand-way--site" aria-labelledby="brand-way-site">
      <span className="g-eyebrow">From the site</span>
      <h2 id="brand-way-site" className="brand-way__title">
        Read it from this site
      </h2>
      <p className="brand-way__body">The colours, fonts and sizes the pages really use, the sections they are built from, and a voice guide written from the site’s own words.</p>
      <ul className="brand-way__list">
        <li>Measured in the preview, page by page</li>
        <li>Read from the site’s styles and sections</li>
        <li>Nothing about the site changes</li>
      </ul>
      <Button variant={state.hasPages ? "primary" : "secondary"} size="lg" onClick={onReadSite} disabled={!state.hasPages}>
        Read it from this site
      </Button>
      {!state.hasPages ? <p className="brand-way__hint">This site has no pages yet, so there is nothing to read from it.</p> : null}
    </section>
  );
  const fromMaterial = (
    <section className="brand-way brand-way--material" aria-labelledby="brand-way-material">
      <span className="g-eyebrow">From your material</span>
      <h2 id="brand-way-material" className="brand-way__title">
        Set it up from your material
      </h2>
      <p className="brand-way__body">Brand guidelines, logos, screenshots, photos, notes. Each is read for what it says about the look and the voice.</p>
      <SourceDrop siteId={siteId} onAdded={onChange} />
      <WebsiteField siteId={siteId} onAdded={onChange} />
      <SourceList siteId={siteId} sources={state.sources} onChange={onChange} />
      {state.sources.some((s) => !s.ignored) ? (
        <Button variant="primary" size="lg" onClick={onReadMaterial}>
          {state.sources.length === 1 ? "Set it up from 1 file" : `Set it up from ${state.sources.filter((s) => !s.ignored).length} files`}
        </Button>
      ) : null}
      <p className="brand-way__hint">Files over {Math.round(state.settings.largeFileBytes / (1024 * 1024))} MB stay in this app’s own folder for the site, not in the site itself.</p>
    </section>
  );

  return (
    <div className="brand-start">
      <p className="brand-start__lede">A brand is the site’s look and voice written down — so every page, image and sentence the assistant makes fits the rest.</p>
      {!state.assistant ? <p className="brand-start__note">No assistant key is set: colours, fonts and sizes can still be read, but the voice guide needs the assistant. Add a key in Settings.</p> : null}
      <div className="brand-ways">
        {state.hasPages ? (
          <>
            {fromSite}
            {fromMaterial}
          </>
        ) : (
          <>
            {fromMaterial}
            {fromSite}
          </>
        )}
      </div>
    </div>
  );
}
