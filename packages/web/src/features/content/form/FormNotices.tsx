import { useEffect, useState } from "react";
import type { Field } from "@galley/core/types";
import { count } from "@/lib/format";
import { Button, ErrorState, ProofMark } from "@/ui";
import { useForm, useFormState } from "./context";
import { describeStructureLoss, labelForPath, previewValue } from "./labels";
import type { OutsideKind } from "./outside";

/** The file changed under an edit: say so, show what was typed, offer to put it back. `noun` names the file ("page", "form", "scripts setup"). */
export function ConflictNotice({ fields, noun = "page" }: { fields: readonly Field[]; noun?: string }) {
  const { store } = useForm();
  const conflict = useFormState((state) => state.conflict);
  // Read, not subscribed: labels only need the section types, and typing shouldn't re-render this.
  const data = store.getState().data;
  if (!conflict) return null;
  const edits = conflict.edits.length + (conflict.body !== null ? 1 : 0);
  return (
    <div className="app-notice app-notice--warning" role="alert">
      <ProofMark kind="bang" className="app-notice__mark" />
      <div className="app-notice__main">
        <p className="app-notice__title">This {noun} changed while you were editing</p>
        <p className="app-notice__body">
          A newer version was saved, so {edits + conflict.structure.length === 1 ? "your last edit wasn’t" : `your last ${count(edits + conflict.structure.length, "edit")} weren’t`} saved. The form now shows the newer version.
        </p>
        {edits > 0 ? (
          <ul className="app-notice__list">
            {conflict.edits.map((edit) => (
              <li key={edit.path.join(".")}>
                <b>{labelForPath(fields, data, edit.path)}</b> <span className="g-muted">{previewValue(edit.value)}</span>
              </li>
            ))}
            {conflict.body !== null ? (
              <li>
                <b>Main text</b> <span className="g-muted">your changes</span>
              </li>
            ) : null}
          </ul>
        ) : null}
        {conflict.structure.length > 0 ? (
          <>
            <p className="app-notice__body">
              These can’t be put back, because the sections and items have changed since. Make them again if you still want them:
            </p>
            <ul className="app-notice__list">
              {conflict.structure.map((loss, index) => (
                <li key={index}>{describeStructureLoss(fields, loss)}</li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="app-notice__actions">
          {edits > 0 ? (
            <Button size="sm" variant="primary" onClick={() => store.actions.reapply()}>
              Put my edits back
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" onClick={() => store.actions.dismissConflict()}>
            {edits > 0 ? "Keep the newer version" : "Dismiss"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A save didn't reach the engine (offline, server stopped): the edit is still here; try again. */
export function SaveErrorNotice() {
  const { store } = useForm();
  const error = useFormState((state) => state.saveError);
  if (!error) return null;
  return (
    <ErrorState
      compact
      title="Couldn’t save your last edit"
      error={error}
      message="Your edit is still in the form. Check that the app’s server is running, then try again."
      onRetry={() => store.actions.retry()}
      className="app-notice-error"
    />
  );
}

const ORIGIN_WORDS: Record<OutsideKind, string> = {
  agent: "The assistant changed this page. The form shows its edits.",
  external: "This page changed outside the app. The form shows the latest version.",
};

const SHOW_MS = 9000;

/** A quiet note when a fresh copy from somewhere else was folded into the form. */
export function OutsideNotice() {
  const outside = useFormState((state) => state.outside);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!outside) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(timer);
  }, [outside]);
  if (!outside || !visible) return null;
  return (
    <p className="g-margin-note app-outside" role="status">
      <ProofMark kind="transpose" />
      <span>{outside.origin === "agent" ? ORIGIN_WORDS.agent : ORIGIN_WORDS.external}</span>
    </p>
  );
}
