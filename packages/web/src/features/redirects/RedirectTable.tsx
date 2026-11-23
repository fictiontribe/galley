/**
 * The list: old address → new address, permanent or temporary, a note,
 * where it came from. Virtualised by fixed row height, so ten thousand rows
 * scroll like ten. Edit in place (Enter saves, Escape cancels), add one at
 * the top, delete with Undo. There is no reordering: every host needs the
 * same order (exact addresses first, then wildcards from the most specific)
 * and the list keeps it by itself.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Redirect, RedirectIssue, RedirectStatus } from "@galley/core/redirects-info";
import { Button, IconButton, Input, ProofMark, Select, Tooltip, cx } from "@/ui";
import { KIND_OPTIONS, issuesByRow, kindWord, newAddressParts, oldAddressParts, sourceLabel, visibleWindow } from "./words";

const ROW = 52;

export interface Row {
  redirect: Redirect;
  /** Position in the full list (what issues and saves refer to). */
  index: number;
}

/** An address that may be cut short by its column: the whole of it on hover, and on keyboard focus. */
function FullAddress({ full, children }: { full: string; children: ReactNode }) {
  return (
    <Tooltip content={<span className="g-mono redir-full">{full}</span>}>
      <span className="redir-address" tabIndex={0} aria-label={full}>
        {children}
      </span>
    </Tooltip>
  );
}

function OldAddress({ from }: { from: string }) {
  const { lead, path } = oldAddressParts(from);

  return (
    <FullAddress full={from}>
      {lead ? <span className="redir-address__lead">{lead} </span> : null}
      <span className="g-mono redir-address__path">{path}</span>
    </FullAddress>
  );
}

function NewAddress({ to }: { to: string }) {
  const { path, tail } = newAddressParts(to);

  return (
    <FullAddress full={to}>
      <span className="g-mono redir-address__path">{path}</span>
      {tail ? <span className="redir-address__lead"> {tail}</span> : null}
    </FullAddress>
  );
}

function Kind({ status }: { status: RedirectStatus }) {
  return (
    <span className="redir-kind">
      {kindWord(status)} <span className="redir-kind__code g-mono">{status}</span>
    </span>
  );
}

function ProblemMark({ issues }: { issues: RedirectIssue[] | undefined }) {
  if (!issues?.length) return <span className="redir-row__mark" aria-hidden="true" />;
  const worst = issues.some((issue) => issue.severity === "error") ? "error" : issues.some((issue) => issue.severity === "warning") ? "warning" : "info";
  const text = issues.map((issue) => issue.message).join(" ");

  return (
    <Tooltip content={text}>
      <span className={`redir-row__mark redir-row__mark--${worst}`} tabIndex={0} role="img" aria-label={text}>
        <ProofMark kind={worst === "info" ? "stet" : "bang"} />
      </span>
    </Tooltip>
  );
}

interface EditorProps {
  initial: Redirect;
  onSave: (redirect: Redirect) => Promise<boolean>;
  onCancel: () => void;
  saveLabel: string;
}

/** One row's inputs. Enter saves, Escape cancels; focus starts in the old address. */
export function RedirectEditor({ initial, onSave, onCancel, saveLabel }: EditorProps) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [status, setStatus] = useState<RedirectStatus>(initial.status);
  const [note, setNote] = useState(initial.note ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);

  const save = async () => {
    const cleanFrom = from.trim();
    const cleanTo = to.trim();

    if (!cleanFrom.startsWith("/")) return setProblem("The old address starts with “/”, like /old-page/.");
    if (!cleanTo.startsWith("/") && !/^https?:\/\//i.test(cleanTo)) return setProblem("The new address starts with “/” or “https://”.");
    setProblem(null);
    setBusy(true);
    const saved = await onSave({ ...initial, from: cleanFrom, to: cleanTo, status, ...(note.trim() ? { note: note.trim() } : { note: undefined }), source: initial.source ?? "manual" });

    setBusy(false);
    if (!saved) setProblem("It wasn’t saved. See the message above.");
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <div className="redir-edit" role="group" aria-label={initial.from ? `Edit the redirect from ${initial.from}` : "New redirect"} onKeyDown={onKey}>
      <Input ref={first} size="sm" mono value={from} placeholder="/old-page/" aria-label="Old address" onChange={(event) => setFrom(event.target.value)} />
      <span className="redir-arrow" aria-hidden="true">→</span>
      <Input size="sm" mono value={to} placeholder="/new-page/" aria-label="New address" onChange={(event) => setTo(event.target.value)} />
      <Select value={String(status)} onChange={(value) => setStatus(Number(value) as RedirectStatus)} options={KIND_OPTIONS} aria-label="Kind" />
      <Input size="sm" value={note} placeholder="Note (optional)" aria-label="Note" onChange={(event) => setNote(event.target.value)} />
      <span className="redir-edit__actions">
        <Button size="sm" variant="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
          {saveLabel}
        </Button>
        <Button size="sm" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </span>
      {problem ? <p className="redir-edit__problem" role="alert">{problem}</p> : null}
    </div>
  );
}

export interface RedirectTableProps {
  rows: Row[];
  issues: RedirectIssue[];
  total: number;
  editing: number | null;
  onEdit: (index: number | null) => void;
  onSave: (index: number, redirect: Redirect) => Promise<boolean>;
  onDelete: (index: number) => void;
}

export function RedirectTable({ rows, issues, total, editing, onEdit, onSave, onDelete }: RedirectTableProps) {
  const body = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 640 });
  const byRow = useMemo(() => issuesByRow(issues), [issues]);
  const window = visibleWindow(scroll.top, scroll.height, ROW, rows.length);
  const height = Math.min(rows.length * ROW, 14 * ROW);

  useEffect(() => {
    const element = body.current;

    if (!element) return;
    const observer = new ResizeObserver(() => setScroll((current) => ({ ...current, height: element.clientHeight || 640 })));

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="redir-table" role="table" aria-label="Redirects" aria-rowcount={rows.length + 1}>
      <div className="redir-table__head" role="row" aria-rowindex={1}>
        <span role="columnheader" className="redir-col--mark">
          <span className="g-sr">Problems</span>
        </span>
        <span role="columnheader">Old address</span>
        <span role="columnheader" aria-hidden="true" />
        <span role="columnheader">New address</span>
        <span role="columnheader">Kind</span>
        <span role="columnheader" className="redir-col--source">Came from</span>
        <span role="columnheader">
          <span className="g-sr">Actions</span>
        </span>
      </div>
      <div ref={body} className="redir-table__body" style={{ blockSize: Math.max(height, ROW) }} onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })} tabIndex={-1}>
        <div style={{ blockSize: rows.length * ROW, position: "relative" }}>
          {rows.slice(window.start, window.end).map((row, offset) => {
            const position = window.start + offset;
            const { redirect, index } = row;

            return (
              <div key={`${index}:${redirect.from}`} role="row" aria-rowindex={position + 2} className={cx("redir-row", editing === index && "redir-row--editing")} style={{ transform: `translateY(${position * ROW}px)` }}>
                {editing === index ? (
                  <RedirectEditor initial={redirect} saveLabel="Save" onCancel={() => onEdit(null)} onSave={(next) => onSave(index, next)} />
                ) : (
                  <>
                    <span role="cell" className="redir-col--mark">
                      <ProblemMark issues={byRow.get(index)} />
                    </span>
                    <span role="cell" className="redir-cell">
                      <OldAddress from={redirect.from} />
                    </span>
                    <span role="cell" className="redir-arrow" aria-label="goes to">
                      →
                    </span>
                    <span role="cell" className="redir-cell redir-cell--stack">
                      <NewAddress to={redirect.to} />
                      {redirect.note ? (
                        <span className="redir-note" title={redirect.note}>
                          {redirect.note}
                        </span>
                      ) : null}
                    </span>
                    <span role="cell" className="redir-cell" title={`${kindWord(redirect.status)} (${redirect.status})`}>
                      <Kind status={redirect.status} />
                    </span>
                    <span role="cell" className="redir-col--source redir-cell g-faint" title={sourceLabel(redirect.source)}>
                      {sourceLabel(redirect.source)}
                    </span>
                    <span role="cell" className="redir-row__actions">
                      <IconButton icon="settings" label={`Edit the redirect from ${redirect.from}`} onClick={() => onEdit(index)} />
                      <IconButton icon="trash" label={`Delete the redirect from ${redirect.from}`} onClick={() => onDelete(index)} />
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {rows.length < total ? <p className="redir-table__foot g-hint">{`Showing ${rows.length.toLocaleString()} of ${total.toLocaleString()}.`}</p> : null}
    </div>
  );
}
