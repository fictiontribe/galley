/**
 * Additions: what a program that builds its own edition of the editor may
 * draw in the app. Experimental: these shapes may change in any 0.x
 * release, and the changelog says so under "Embedding".
 *
 * An addition is part of the one bundle. It is given to the root component
 * when the program is built (`<App additions={[…]} />`) and nowhere else:
 * no global, address, message or stored value adds one. It is not
 * sandboxed: it can import any module of the app, and a mistake in it is
 * its author's. What the app does for it: a place that crashes while it
 * draws, or waits, shows nothing there and leaves the screen as it was.
 */
import type { ComponentType, ReactNode } from "react";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Collection, Entry, Field, FieldPath, FileChange, OverlaySectionList } from "@galley/core/types";
import type { FormStore } from "@/features/content/form/store";

export interface BodyAdditionProps {
  siteId: string;
  entryPath: string;
  store: FormStore;
  view: EditorView | null;
  setExtensions: (extensions: Extension[]) => void;
  setReadOnly: (readOnly: boolean) => void;
  setManagedValue: (managed: boolean) => void;
}

export interface Addition {
  /** The same id as its server half: lower-case letters, digits and dashes, 3 to 32, starting with a letter. */
  id: string;
  /**
   * Mounted once inside the signed-in app, and again whenever the person
   * signed in changes. For what an addition keeps going (a subscription, the
   * stream's value); what it draws should be nothing, or small.
   */
  root?: ComponentType;
  /** At the right of the top bar, before the account menu. Small. */
  topBar?: ComponentType;
  /**
   * After the title in a row of a collection's list or site home. Small, and
   * drawn once for every row on screen, again as the list scrolls: one request
   * for the list, shared between rows, not one a row.
   */
  listRow?: ComponentType<{ siteId: string; path: string }>;
  /** Mounted inside an open entry's form to wire incremental sync or transport. Draws nothing. */
  entrySession?: ComponentType<{ siteId: string; path: string; entry: Entry; store: FormStore; collection: Collection | null }>;
  /** At the top of an open entry's form, below the mode bar and above notices. */
  entryTop?: ComponentType<{ siteId: string; path: string; store: FormStore }>;
  /** Beside a field's label in the entry form. */
  fieldHeader?: ComponentType<{ siteId: string; entryPath: string; path: FieldPath; field: Field }>;
  /** Under a field's control in the entry form (e.g. a per-field notice). */
  fieldNotice?: ComponentType<{ siteId: string; entryPath: string; path: FieldPath; field: Field }>;
  /** Optional wrapper around a field's control box (e.g. an active outline). */
  fieldFrame?: ComponentType<{ siteId: string; entryPath: string; path: FieldPath; field: Field; children: ReactNode }>;
  /** On a section/list card's header in the entry form. */
  sectionHeader?: ComponentType<{ siteId: string; entryPath: string; listPath: FieldPath; index: number; open: boolean }>;
  /** Mounted inside the main-text body editor to show a notice or attach CodeMirror extensions. */
  bodyAddon?: ComponentType<BodyAdditionProps>;
  /** On each file row in Proof's change list. */
  proofRow?: ComponentType<{ siteId: string; path: string; status: FileChange["status"] }>;
  /** In the header of Proof's change detail view. */
  proofDetail?: ComponentType<{ siteId: string; path: string }>;
  /** Inside the Publish dialog above the file list. */
  publishNotice?: ComponentType<{ siteId: string; paths: string[] }>;
  /** Inside the Arrange panel beside the preview. */
  arrangePanel?: ComponentType<{ siteId: string; entryPath: string; fieldKey: string; labels: string[] }>;
  /** Mounted inside PreviewPane to push colour-only section marks to the overlay. */
  previewHost?: ComponentType<{ siteId: string; entryPath?: string; lists: OverlaySectionList[]; postMarks: (marks: Array<{ field: string; index: number; color: string }>) => void }>;
}

/** The places an addition can draw in. */
export type AdditionPlace =
  | "root"
  | "topBar"
  | "listRow"
  | "entrySession"
  | "entryTop"
  | "fieldHeader"
  | "fieldNotice"
  | "fieldFrame"
  | "sectionHeader"
  | "bodyAddon"
  | "proofRow"
  | "proofDetail"
  | "publishNotice"
  | "arrangePanel"
  | "previewHost";
