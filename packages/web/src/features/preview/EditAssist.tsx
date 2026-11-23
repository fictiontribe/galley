import { useRef, useState, type CSSProperties, type RefObject } from "react";
import type { OverlayRect, SourceMatch } from "@galley/core/types";
import { MediaPicker } from "@/features/media/MediaPicker";
import { useSite } from "@/lib/stores/site";
import { Button, Popover, ProofMark, Textarea } from "@/ui";
import { matchLabel } from "./clickToEdit";
import type { Assist, ImageSpot } from "./useClickToEdit";

export interface EditAssistProps {
  siteId: string;
  assist: Assist;
  /** The proposed frame, to place popovers over the element that was clicked. */
  frame: RefObject<HTMLIFrameElement | null>;
  onClose: () => void;
  onSaveStored: (value: string) => Promise<void>;
  onChoose: (match: SourceMatch) => void;
  onChooseSpot: (spot: ImageSpot) => void;
  onPickImage: (url: string) => Promise<void>;
  onAsk?: (text: string, kind?: "text" | "image") => void;
  onShowForm?: () => void;
}

/**
 * Where the clicked element sits on screen: the frame's box plus the rect the
 * overlay reported. Computed while rendering so the popover, which measures
 * its anchor in its own layout effect, finds it already in place.
 */
function anchorStyle(frame: HTMLIFrameElement | null, rect: OverlayRect | null): CSSProperties {
  const box = frame?.getBoundingClientRect();
  if (!box || !rect) return { display: "none" };
  const left = Math.min(Math.max(box.left + rect.x, box.left), box.right - 8);
  const top = Math.min(Math.max(box.top + rect.y, box.top), box.bottom - 8);
  return {
    left,
    top,
    width: Math.max(1, Math.min(rect.width, box.right - left)),
    height: Math.max(1, Math.min(rect.height, box.bottom - top)),
  };
}

function StoredEditor({ match, label, error, onSave, onClose }: { match: SourceMatch; label: string; error?: string; onSave: (value: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(match.value);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    await onSave(value);
    setBusy(false);
  };
  return (
    <form
      className="preview-assist"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="g-eyebrow">{label}</p>
      <Textarea
        aria-label={label}
        value={value}
        maxRows={10}
        data-autofocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <p className="preview-assist__note">
        <ProofMark kind="pilcrow" />
        <span>This text carries formatting the page doesn’t show, like emphasis or a link, so you’re editing it as it’s stored. Keep the marks where you want them.</span>
      </p>
      {error ? (
        <p className="g-error-text" role="alert">
          <ProofMark kind="bang" />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="preview-assist__actions">
        <Button type="button" variant="quiet" size="sm" onClick={onClose}>
          Leave as is
        </Button>
        <Button type="submit" variant="primary" size="sm" busy={busy} busyLabel="Saving…" disabled={value === match.value}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** The popovers of click to edit: edit as stored, choose a place, design text, which image. */
export function EditAssist({ siteId, assist, frame, onClose, onSaveStored, onChoose, onChooseSpot, onPickImage, onAsk, onShowForm }: EditAssistProps) {
  const collections = useSite((s) => s.detail?.model.collections);
  const rect = "rect" in assist ? assist.rect : null;
  const anchor = useRef<HTMLDivElement>(null);
  const label = (match: SourceMatch, places = false) => matchLabel(match, collections?.find((collection) => collection.id === match.collection)?.label, { places });

  const surface = (() => {
    switch (assist.kind) {
      case "stored":
        return <StoredEditor key={`${assist.match.path}:${JSON.stringify(assist.match.location)}`} match={assist.match} label={label(assist.match)} error={assist.error} onSave={onSaveStored} onClose={onClose} />;
      case "choose":
        return (
          <div className="preview-assist">
            <p className="preview-assist__title">Which one did you mean?</p>
            <p className="preview-assist__text">{assist.reason}</p>
            <ul className="preview-assist__choices">
              {assist.matches.map((match) => (
                <li key={`${match.path}:${JSON.stringify(match.location)}`}>
                  <button type="button" className="preview-assist__choice" onClick={() => onChoose(match)}>
                    {/* With each section's place, so two buttons that say the same thing can be told apart. */}
                    <span>{label(match, true)}</span>
                    {!match.editable || match.location.kind === "source" ? <span className="g-faint"> · part of the design</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      case "design":
        return (
          <div className="preview-assist">
            <p className="preview-assist__title">This text is part of the site’s design.</p>
            <p className="preview-assist__text">{assist.reason} The assistant can change it for you.</p>
            <div className="preview-assist__actions">
              <Button variant="quiet" size="sm" onClick={onClose}>
                Close
              </Button>
              {onAsk ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon="chat"
                  data-autofocus
                  onClick={() => {
                    onAsk(assist.text);
                    onClose();
                  }}
                >
                  Ask the assistant to change it
                </Button>
              ) : null}
            </div>
          </div>
        );
      case "image-unknown":
        return (
          <div className="preview-assist">
            <p className="preview-assist__title">This image can’t be swapped by clicking.</p>
            <p className="preview-assist__text">
              It isn’t one of this page’s own image fields. If it belongs to a section, change it in the form, in that section’s image field. Otherwise it’s part of the design, and the assistant can change it.
            </p>
            <div className="preview-assist__actions">
              <Button variant="quiet" size="sm" onClick={onClose}>
                Close
              </Button>
              {onShowForm ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="page"
                  data-autofocus
                  onClick={() => {
                    onShowForm();
                    onClose();
                  }}
                >
                  Show the form
                </Button>
              ) : null}
              {onAsk ? (
                <Button
                  variant={onShowForm ? "quiet" : "primary"}
                  size="sm"
                  icon="chat"
                  onClick={() => {
                    onAsk(assist.text, "image");
                    onClose();
                  }}
                >
                  Ask the assistant
                </Button>
              ) : null}
            </div>
          </div>
        );
      case "image":
        if (assist.chosen) return null;
        return (
          <div className="preview-assist">
            <p className="preview-assist__title">This image is used in more than one place.</p>
            <ul className="preview-assist__choices">
              {assist.spots.map((spot) => (
                <li key={JSON.stringify(spot.path)}>
                  <button type="button" className="preview-assist__choice" onClick={() => onChooseSpot(spot)}>
                    {spot.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <>
      <div ref={anchor} className="preview-anchor" style={anchorStyle(frame.current, rect)} aria-hidden="true" />
      <Popover open={surface !== null} onClose={onClose} anchor={anchor} placement="bottom-start" role="dialog" aria-label="Edit on the page" className="preview-assist-surface">
        {surface}
      </Popover>
      {assist.kind === "image" ? <MediaPicker siteId={siteId} open={assist.chosen !== null} onClose={onClose} onPick={(url) => void onPickImage(url)} /> : null}
    </>
  );
}
