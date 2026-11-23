import { useState, type ReactNode } from "react";
import type { FieldChange, FileChange, FileDiff, JsonValue } from "@galley/core/types";
import { api, errorShape, isApiFailure, rawFileUrl } from "@/lib/api";
import { storeWrittenEntry } from "@/lib/entryWrites";
import { bytes, count } from "@/lib/format";
import { useChanges } from "@/lib/stores/changes";
import { notify } from "@/lib/stores/toasts";
import { putBackOp } from "@/features/content/form/marks";
import { Button, ConfirmDialog, ErrorState, ProofMark, Skeleton } from "@/ui";
import { ProofText, foldUnchanged, hasChanges, hasInlineMarkdown, similarity, wordDiff, type ProofPart } from "@/ui/diff";
import { bodyOf, changeBadge, describeValue, isText, labelParts, movedText, withPublishedBody } from "./changes";
import { useFileDiff } from "./useFileDiff";
import { useSectionLabels } from "./useNames";

/** Long values fold to this many words either side of each change. */
const CONTEXT_WORDS = 10;

function Gutter({ kind }: { kind: "before" | "after" | "changed" }) {
  return (
    <span className="g-change__gutter">
      {kind === "before" ? <ProofMark kind="dele" tone="delete" /> : kind === "after" ? <ProofMark kind="caret" tone="insert" /> : <ProofMark kind="transpose" tone="change" />}
    </span>
  );
}

function Line({ side, children }: { side: "before" | "after"; children: ReactNode }) {
  return (
    <div className={`g-change__line g-change__line--${side}`}>
      <span>
        <span className="g-sr">{side === "before" ? "Before: " : "After: "}</span>
        {children}
      </span>
    </div>
  );
}

/** Whether a stretch of text is long enough to fold. */
const isLong = (value: JsonValue | undefined) => typeof value === "string" && value.split(/\s+/).length > 60;

/** Whether a field's text carries inline Markdown, so "Show as stored" means something. */
const usesMarkdown = (change: FieldChange) => (isText(change.before) && hasInlineMarkdown(change.before)) || (isText(change.after) && hasInlineMarkdown(change.after));

/** A whole value: as it reads (Markdown rendered) or as stored. */
function Value({ value, rendered }: { value: JsonValue | undefined; rendered: boolean }) {
  const labels = useSectionLabels();
  if (rendered && isText(value) && value !== "" && hasInlineMarkdown(value)) return <ProofText parts={[{ kind: "same", text: value }]} markdown />;
  return <>{describeValue(value, labels)}</>;
}

/** The toggle between the text as it reads and its exact stored characters. */
function StoredToggle({ stored, onChange }: { stored: boolean; onChange: (stored: boolean) => void }) {
  return (
    <Button variant="quiet" size="sm" onClick={() => onChange(!stored)} title={stored ? "Show emphasis and links as they appear on the page" : "Show the exact characters that are saved, with their formatting marks"}>
      {stored ? "Show as it reads" : "Show as stored"}
    </Button>
  );
}

function FieldValue({ change, rendered }: { change: FieldChange; rendered: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { before, after } = change;

  if (change.kind === "moved") {
    // The proofreader's transpose mark; the item's own edits are rows of their own.
    return (
      <>
        <Gutter kind="changed" />
        <div className="g-change__line g-muted">{movedText(change)}</div>
      </>
    );
  }
  if (change.kind === "added") {
    return (
      <>
        <Gutter kind="after" />
        <Line side="after">
          <Value value={after} rendered={rendered} />
        </Line>
      </>
    );
  }
  if (change.kind === "removed") {
    return (
      <>
        <Gutter kind="before" />
        <Line side="before">
          <Value value={before} rendered={rendered} />
        </Line>
      </>
    );
  }
  if (isText(before) && isText(after)) {
    const parts = wordDiff(before, after);
    if (similarity(parts) >= 0.45 && hasChanges(parts)) {
      const folded = expanded ? parts : foldUnchanged(parts, CONTEXT_WORDS);
      return (
        <>
          <Gutter kind="changed" />
          <div className="g-change__line g-change__line--words">
            <ProofText parts={folded} markdown={rendered} />
            {folded !== parts ? (
              <button type="button" className="app-link-button proof-more" onClick={() => setExpanded(true)}>
                Show all
              </button>
            ) : null}
          </div>
        </>
      );
    }
  }
  const long = !expanded && (isLong(before) || isLong(after));
  return (
    <>
      <Gutter kind="before" />
      <Line side="before">
        <span className={long ? "proof-clamp" : undefined}>
          <Value value={before} rendered={rendered} />
        </span>
      </Line>
      <Gutter kind="after" />
      <Line side="after">
        <span className={long ? "proof-clamp" : undefined}>
          <Value value={after} rendered={rendered} />
        </span>
      </Line>
      {long ? (
        <div className="g-change__line">
          <button type="button" className="app-link-button proof-more" onClick={() => setExpanded(true)}>
            Show all
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Whether a change names a place in a list, which shifts as items come, go and move. */
const usesPositions = (change: FieldChange) => change.field.some((segment) => typeof segment === "number");

/**
 * Put one change back the way it was published (the op comes from the form's
 * marks: old value, field out, item out, item back in its place, item moved
 * back). A change that names a list position is first matched against the
 * changes as they are now, so an op is never built from a list that has
 * shifted since it was shown.
 */
async function putBack(siteId: string, path: string, change: FieldChange, rows: readonly FieldChange[]): Promise<void> {
  let current = change;
  let siblings = rows;
  if (usesPositions(change)) {
    const fresh = await api("GET /api/sites/:siteId/changes", { params: { siteId } });
    siblings = fresh.files.find((file) => file.path === path)?.fieldChanges ?? [];
    const same = siblings.find((other) => JSON.stringify(other) === JSON.stringify(change));
    if (!same) {
      void useChanges.getState().refresh();
      throw new Error("The page changed since this list was shown. Check the list again, then put it back.");
    }
    current = same;
  }
  const op = putBackOp(current, siblings);
  if (!op) throw new Error("This change can’t be put back on its own.");
  const result = await api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path }, body: { ops: [op] } });
  const refusal = result.refused[0];
  if (refusal) throw new Error(refusal.reason);
  // The editor shares this copy, so its form updates without announcing anything.
  storeWrittenEntry(siteId, result.entry);
  // Positions of the other rows may have shifted; show them as they are now rather than after the next change event.
  void useChanges.getState().refresh();
}

function FieldChangeView({ siteId, path, change, rows }: { siteId: string; path: string; change: FieldChange; rows: readonly FieldChange[] }) {
  const { lead, rest } = labelParts(change.label);
  const badge = changeBadge(change);
  const name = lead ? `${lead} › ${rest}` : rest;
  // No button where the result would be a guess (see putBackOp).
  const canPutBack = putBackOp(change, rows) !== null;
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(false);
  const markdown = usesMarkdown(change);
  const run = async () => {
    setBusy(true);
    try {
      await putBack(siteId, path, change, rows);
      notify({ tone: "neutral", title: `Put back ${name}`, body: change.kind === "moved" ? "It sits where it does on the live site again." : "It reads as it does on the live site again." });
    } catch (error) {
      const shape = errorShape(error);
      const body = isApiFailure(error) || !(error instanceof Error) ? shape.message : error.message;
      notify({ tone: "danger", title: `Couldn’t put back ${name}`, body, detail: isApiFailure(error) ? shape.detail : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="g-change proof-change" aria-label={change.label}>
      <div className="g-change__head">
        <span className="g-change__path">
          {lead ? (
            <>
              <b>{lead}</b> ›{" "}
            </>
          ) : null}
          {rest}
        </span>
        {badge ? <span className="g-change__entry">{badge}</span> : null}
      </div>
      <div className="g-change__actions">
        {markdown ? <StoredToggle stored={stored} onChange={setStored} /> : null}
        {canPutBack ? (
          <Button variant="quiet" size="sm" busy={busy} busyLabel="Putting back" onClick={() => void run()} title={change.kind === "moved" ? "Move it back to where it is on the live site" : "Use the published version of this field"}>
            Put back
          </Button>
        ) : null}
      </div>
      <FieldValue change={change} rendered={markdown && !stored} />
    </article>
  );
}

/** Edits longer than this many changed words ask before the main text is put back. */
const CONFIRM_WORDS = 30;

const changedWords = (parts: ProofPart[]) =>
  parts.reduce((sum, part) => sum + (part.kind === "ins" || part.kind === "del" ? (part.text.match(/\S+/g) ?? []).length : 0), 0);

/**
 * Put the main text back exactly as published, keeping every field as it is
 * now. The whole file is written in one go against the copy just read, so a
 * change made meanwhile is never overwritten. Resolves with an undo.
 */
async function putBackBody(siteId: string, path: string, published: string): Promise<(() => Promise<void>) | null> {
  const current = await api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path } });
  const next = withPublishedBody(current.raw, published);
  if (next === null) return null;
  const result = await api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path }, body: { ops: [{ op: "raw", value: next }], baseHash: current.hash } });
  const refusal = result.refused[0];
  if (refusal) throw new Error(refusal.reason);
  storeWrittenEntry(siteId, result.entry);
  return async () => {
    const undone = await api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path }, body: { ops: [{ op: "raw", value: current.raw }], baseHash: result.entry.hash } });
    const refused = undone.refused[0];
    if (refused) throw new Error(refused.reason);
    storeWrittenEntry(siteId, undone.entry);
  };
}

function BodyChange({ siteId, path, diff }: { siteId: string; path: string; diff: FileDiff }) {
  const [expanded, setExpanded] = useState(false);
  const [stored, setStored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const before = bodyOf(diff.before);
  const after = bodyOf(diff.after);
  const parts = wordDiff(before, after);
  const folded = expanded ? parts : foldUnchanged(parts, 14, 90);
  const markdown = hasInlineMarkdown(before) || hasInlineMarkdown(after);
  const words = changedWords(parts);
  const canPutBack = diff.status === "modified" && diff.before !== null && diff.after !== null && withPublishedBody(diff.after, diff.before) !== null;

  const run = async () => {
    if (diff.before === null) return;
    setBusy(true);
    try {
      const undo = await putBackBody(siteId, path, diff.before);
      if (!undo) {
        notify({ tone: "neutral", title: "Nothing to put back", body: "The text already matches the published version." });
        return;
      }
      notify({
        tone: "neutral",
        title: "Put back the main text",
        body: "It reads as it does on the live site again. The fields keep their edits.",
        action: {
          label: "Undo",
          onClick: () => void undo().catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t undo", body: error instanceof Error && !isApiFailure(error) ? error.message : errorShape(error).message })),
        },
      });
    } finally {
      setBusy(false);
    }
  };
  const runNow = () =>
    run().catch((error: unknown) => {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t put back the main text", body: error instanceof Error && !isApiFailure(error) ? error.message : shape.message, detail: isApiFailure(error) ? shape.detail : undefined });
    });

  return (
    <section className="proof-body" aria-label="Main text">
      <div className="proof-body__head">
        <p className="g-eyebrow">Main text</p>
        <div className="g-change__actions">
          {markdown ? <StoredToggle stored={stored} onChange={setStored} /> : null}
          {canPutBack ? (
            <Button variant="quiet" size="sm" busy={busy} busyLabel="Putting back" title="Use the published version of the main text" onClick={() => (words > CONFIRM_WORDS ? setConfirming(true) : void runNow())}>
              Put back
            </Button>
          ) : null}
        </div>
      </div>
      {hasChanges(parts) ? (
        <div className="g-proof-text proof-body__text">
          <ProofText parts={folded} markdown={markdown && !stored} />
        </div>
      ) : (
        <p className="g-muted">Only spacing or line breaks changed.</p>
      )}
      {folded !== parts ? (
        <button type="button" className="app-link-button proof-more" onClick={() => setExpanded(true)}>
          Show the whole text
        </button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Put back the main text?"
        body={`This throws away ${count(words, "changed word")} in the main text and puts back the published text. The fields keep their edits.`}
        confirmLabel="Put back"
        busyLabel="Putting back…"
        cancelLabel="Keep editing"
        errorTitle="Couldn’t put back the main text"
        onConfirm={run}
      />
    </section>
  );
}

function Picture({ src, label, removed, size: fileSize }: { src: string; label: string; removed?: boolean; size?: number }) {
  const [size, setSize] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <figure className={removed ? "proof-image proof-image--before" : "proof-image"}>
      <div className="proof-image__frame g-crop">
        {failed ? (
          <p className="g-hint">This image can’t be shown here.</p>
        ) : (
          <img
            src={src}
            alt={label}
            onLoad={(event) => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption className="proof-image__caption">
        <span className="g-eyebrow">{label}</span>
        {size || fileSize ? <span className="g-mono g-faint">{[size, fileSize ? bytes(fileSize) : null].filter(Boolean).join(" · ")}</span> : null}
      </figcaption>
    </figure>
  );
}

function ImageCompare({ siteId, change, diff }: { siteId: string; change: FileChange; diff: FileDiff | undefined }) {
  const before = diff?.beforeMediaUrl ?? rawFileUrl(siteId, change.path, "base");
  const after = diff?.afterMediaUrl ?? rawFileUrl(siteId, change.path);
  return (
    <div className={change.status === "modified" ? "proof-images proof-images--pair" : "proof-images"}>
      {change.status !== "added" ? <Picture src={before} label={change.status === "deleted" ? "Removed" : "Before"} removed /> : null}
      {change.status !== "deleted" ? <Picture src={after} label={change.status === "added" ? "New image" : "After"} size={change.media?.size} /> : null}
    </div>
  );
}

/** "What changed": the change in content terms — fields, body, images. */
export function WhatChanged({ siteId, change }: { siteId: string; change: FileChange }) {
  const needsDiff = Boolean(change.bodyChanged) || change.binary;
  const diff = useFileDiff(siteId, change, needsDiff);

  if (change.binary) return <ImageCompare siteId={siteId} change={change} diff={diff.data} />;

  const fields = change.fieldChanges ?? [];
  return (
    <div className="proof-what">
      {change.status === "deleted" ? <p className="proof-note">This {change.collection ? "page" : "file"} will be removed from the site when you publish.</p> : null}
      {change.status === "added" && fields.length === 0 && !change.bodyChanged ? <p className="proof-note">New — everything in it will go live when you publish.</p> : null}
      {fields.length > 0 ? (
        <div className="app-card proof-fields">
          {fields.map((field) => (
            <FieldChangeView key={`${field.kind}:${JSON.stringify(field.field)}`} siteId={siteId} path={change.path} change={field} rows={fields} />
          ))}
        </div>
      ) : null}
      {needsDiff ? (
        diff.loading ? (
          <div className="proof-body" aria-busy="true">
            <Skeleton lines={4} />
          </div>
        ) : diff.data ? (
          <BodyChange siteId={siteId} path={change.path} diff={diff.data} />
        ) : (
          <ErrorState compact title="Couldn’t show the main text" error={diff.error} onRetry={() => void diff.refetch()} />
        )
      ) : null}
      {fields.length === 0 && !needsDiff && change.status === "modified" ? <p className="proof-note">{change.summary || "The file changed."} The Source view shows each line.</p> : null}
    </div>
  );
}
