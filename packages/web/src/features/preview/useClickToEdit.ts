import { useCallback, useEffect, useRef, useState } from "react";
import type { EditOp, FieldPath, OverlayRect, OverlayToHost, SourceMatch } from "@galley/core/types";
import type { EditorSelection } from "@/features/editor/EditorContext";
import { api, errorShape } from "@/lib/api";
import { storeWrittenEntry } from "@/lib/entryWrites";
import { actionFor, actionForMatch, editFor, fieldPathLabel, findImageFields, type EditAction } from "./clickToEdit";
import { pagePath, toOverlay } from "./frames";

type Select = Extract<OverlayToHost, { type: "select" }>;
type SelectImage = Extract<OverlayToHost, { type: "select-image" }>;
type Edit = Extract<OverlayToHost, { type: "edit" }>;
type EditCancelled = Extract<OverlayToHost, { type: "edit-cancelled" }>;

export interface ImageSpot {
  path: FieldPath;
  label: string;
}

export type Assist =
  | { kind: "idle" }
  | { kind: "resolving"; rect: OverlayRect }
  | { kind: "editing"; text: string; match: SourceMatch }
  | { kind: "stored"; rect: OverlayRect; match: SourceMatch; error?: string }
  | { kind: "choose"; rect: OverlayRect; text: string; occurrence: number; matches: SourceMatch[]; reason: string }
  | { kind: "design"; rect: OverlayRect; text: string; reason: string }
  /** An image that isn't one of this page's image fields (it may be in a section, or part of the design). */
  | { kind: "image-unknown"; rect: OverlayRect; text: string }
  | { kind: "image"; rect: OverlayRect; entryPath: string; spots: ImageSpot[]; chosen: ImageSpot | null };

export type Notice = { tone: "working" | "done" | "problem"; text: string } | null;

export interface ClickToEditOptions {
  siteId: string;
  /** The page the proposed frame is on. */
  currentPath: () => string;
  /** Post to the proposed frame. */
  send: (message: ReturnType<typeof toOverlay>) => void;
  onSelection?: (selection: EditorSelection | null) => void;
}

const IDLE: Assist = { kind: "idle" };

/** The click-to-edit conversation: select → resolve → edit in place, edit as stored, choose, or hand to the assistant. */
export function useClickToEdit({ siteId, currentPath, send, onSelection }: ClickToEditOptions) {
  const [assist, setAssist] = useState<Assist>(IDLE);
  const [notice, setNotice] = useState<Notice>(null);
  const ticket = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((next: Notice) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(next);
    if (next && next.tone !== "working") noticeTimer.current = setTimeout(() => setNotice(null), next.tone === "done" ? 4000 : 9000);
  }, []);
  useEffect(() => () => void (noticeTimer.current && clearTimeout(noticeTimer.current)), []);

  /** Write a value where the resolver said it lives. Returns why it was refused, or null. */
  const save = useCallback(
    async (path: string, ops: EditOp[]): Promise<string | null> => {
      say({ tone: "working", text: "Saving…" });
      try {
        const result = await api("PATCH /api/sites/:siteId/entry", { params: { siteId }, query: { path }, body: { ops } });
        const refusal = result.refused[0];
        if (refusal) {
          say({ tone: "problem", text: `Couldn’t change it. ${refusal.reason}` });
          return refusal.reason;
        }
        storeWrittenEntry(siteId, result.entry);
        say(result.applied > 0 ? { tone: "done", text: "Saved. It’s waiting in Proof." } : { tone: "done", text: "Nothing changed." });
        return null;
      } catch (error) {
        const { message } = errorShape(error);
        say({ tone: "problem", text: `Couldn’t change it. ${message}` });
        return message;
      }
    },
    [siteId, say],
  );

  const apply = useCallback(
    (action: EditAction, select: { text: string; occurrence: number; rect: OverlayRect }) => {
      switch (action.kind) {
        case "in-place":
          send(toOverlay({ type: "begin-edit", text: select.text, occurrence: select.occurrence }));
          setAssist({ kind: "editing", text: select.text, match: action.match });
          return;
        case "stored":
          setAssist({ kind: "stored", rect: select.rect, match: action.match });
          return;
        case "choose":
          setAssist({ kind: "choose", rect: select.rect, text: select.text, occurrence: select.occurrence, matches: action.matches, reason: action.reason });
          return;
        case "design":
          setAssist({ kind: "design", rect: select.rect, text: select.text, reason: action.reason });
      }
    },
    [send],
  );

  const onSelect = useCallback(
    async (message: Select) => {
      const mine = ++ticket.current;
      onSelection?.({ text: message.text });
      setAssist({ kind: "resolving", rect: message.rect });
      try {
        const result = await api("POST /api/sites/:siteId/resolve", {
          params: { siteId },
          body: { urlPath: pagePath(currentPath()), text: message.text, occurrence: message.occurrence, total: message.total },
        });
        if (mine !== ticket.current) return;
        const action = actionFor(result);
        if (action.kind === "in-place" || action.kind === "stored") onSelection?.({ text: message.text, sourcePath: action.match.path });
        apply(action, message);
      } catch (error) {
        if (mine !== ticket.current) return;
        setAssist(IDLE);
        send(toOverlay({ type: "cancel-edit" }));
        say({ tone: "problem", text: `Couldn’t find where this text lives. ${errorShape(error).message}` });
      }
    },
    [siteId, currentPath, apply, onSelection, send, say],
  );

  const onSelectImage = useCallback(
    async (message: SelectImage) => {
      const mine = ++ticket.current;
      onSelection?.(message.alt ? { text: message.alt } : null);
      setAssist({ kind: "resolving", rect: message.rect });
      const design = { kind: "image-unknown" as const, rect: message.rect, text: message.alt };
      try {
        const { entry: summary } = await api("GET /api/sites/:siteId/route", { params: { siteId }, query: { url: pagePath(currentPath()) } });
        if (!summary) {
          if (mine === ticket.current) setAssist(design);
          return;
        }
        const entry = await api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: summary.path } });
        if (mine !== ticket.current) return;
        const spots = findImageFields(entry.data, message.src).map((path) => ({ path, label: fieldPathLabel(entry.fields, entry.data, path) }));
        if (spots.length === 0) setAssist(design);
        else setAssist({ kind: "image", rect: message.rect, entryPath: entry.path, spots, chosen: spots.length === 1 ? (spots[0] ?? null) : null });
      } catch (error) {
        if (mine !== ticket.current) return;
        setAssist(IDLE);
        say({ tone: "problem", text: `Couldn’t find where this image lives. ${errorShape(error).message}` });
      }
    },
    [siteId, currentPath, onSelection, say],
  );

  const onEdit = useCallback(
    async (message: Edit) => {
      if (assist.kind !== "editing" || assist.text !== message.text) return;
      const { match } = assist;
      setAssist(IDLE);
      // Older overlays said "cancelled" as an edit that changed nothing.
      if (message.newText === message.text) return;
      const edit = editFor(match, message.newText);
      if (!edit) return;
      const refused = await save(edit.path, edit.ops);
      // The page still shows the retyped text; put back what's really stored.
      if (refused) send(toOverlay({ type: "restore-text", text: message.text, newText: message.newText, occurrence: message.occurrence }));
    },
    [assist, save, send],
  );

  /** The person left the in-place edit without keeping it. */
  const onEditCancelled = useCallback(
    (message: EditCancelled) => {
      if (assist.kind !== "editing" || assist.text !== message.text) return;
      setAssist(IDLE);
    },
    [assist],
  );

  const close = useCallback(() => {
    ticket.current++;
    setAssist(IDLE);
    send(toOverlay({ type: "cancel-edit" }));
  }, [send]);

  const saveStored = useCallback(
    async (value: string) => {
      if (assist.kind !== "stored") return;
      const edit = editFor(assist.match, value);
      if (!edit) return;
      if (value === assist.match.value) {
        close();
        return;
      }
      const refused = await save(edit.path, edit.ops);
      if (refused) setAssist({ ...assist, error: refused });
      else close();
    },
    [assist, save, close],
  );

  const choose = useCallback(
    (match: SourceMatch) => {
      if (assist.kind !== "choose") return;
      onSelection?.({ text: assist.text, sourcePath: match.path });
      apply(actionForMatch(match), { text: assist.text, occurrence: assist.occurrence, rect: assist.rect });
    },
    [assist, apply, onSelection],
  );

  const chooseSpot = useCallback((spot: ImageSpot) => setAssist((current) => (current.kind === "image" ? { ...current, chosen: spot } : current)), []);

  const pickImage = useCallback(
    async (url: string) => {
      if (assist.kind !== "image" || !assist.chosen) return;
      const { entryPath, chosen } = assist;
      close();
      await save(entryPath, [{ op: "set", path: chosen.path, value: url }]);
    },
    [assist, close, save],
  );

  return { assist, notice, onSelect, onSelectImage, onEdit, onEditCancelled, close, saveStored, choose, chooseSpot, pickImage, dismissNotice: () => say(null) };
}
