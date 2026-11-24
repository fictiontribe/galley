import { useEffect, useState } from "react";
import { IconButton, SegmentedControl, buttonClass, keyName } from "@/ui";
import { Icon } from "@/ui/Icon";

export type FrameWidth = "desktop" | "tablet" | "phone";

/** What a click on the page does: retype text and swap images, arrange its sections, or nothing (just look). */
export type PageTool = "edit" | "arrange" | "browse";

export const WIDTHS: Record<FrameWidth, number | null> = { desktop: null, tablet: 768, phone: 390 };

const WIDTH_OPTIONS: Array<{ value: FrameWidth; label: string; title: string }> = [
  { value: "desktop", label: "Desktop", title: "Full width" },
  { value: "tablet", label: "Tablet", title: "768 pixels wide" },
  { value: "phone", label: "Phone", title: "390 pixels wide" },
];

export interface PreviewToolbarProps {
  path: string;
  /** Returns an error sentence when the address isn't a page of this site. */
  onGo: (address: string) => string | null;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  width: FrameWidth;
  onWidth: (width: FrameWidth) => void;
  /** Absent when the page can't be changed from here (live site, Proof). `arrange` false: the page has no sections to arrange. */
  tool?: { value: PageTool; onChange: (tool: PageTool) => void; arrange: boolean };
  /** The page on the preview's own address, to open in a new tab. */
  openUrl: string | null;
}

/** Back, forward, reload, the page's address, widths, click to edit, open in a new tab. */
export function PreviewToolbar({ path, onGo, canBack, canForward, onBack, onForward, onReload, width, onWidth, tool, openUrl }: PreviewToolbarProps) {
  const [draft, setDraft] = useState(path);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setDraft(path);
  }, [path, editing]);

  return (
    <div className="preview-toolbar" role="toolbar" aria-label="Preview">
      <IconButton icon="chevron-left" label="Back" disabled={!canBack} onClick={onBack} />
      <IconButton icon="chevron-right" label="Forward" disabled={!canForward} onClick={onForward} />
      <IconButton icon="refresh" label="Reload the page" onClick={onReload} />
      <form
        className="preview-address"
        onSubmit={(event) => {
          event.preventDefault();
          const problem = onGo(draft);
          setError(problem);
          if (!problem) {
            setEditing(false);
            (document.activeElement as HTMLElement | null)?.blur();
          }
        }}
      >
        <label className="g-sr" htmlFor="preview-address">
          Page address
        </label>
        <input
          id="preview-address"
          className="g-input g-input--sm g-input--mono preview-address__input"
          value={draft}
          title={draft}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "preview-address-error" : undefined}
          onFocus={(event) => {
            setEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            setEditing(false);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(path);
              setError(null);
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error ? (
          <span id="preview-address-error" className="preview-address__error" role="alert">
            {error}
          </span>
        ) : null}
      </form>
      <SegmentedControl label="Page width" options={WIDTH_OPTIONS} value={width} onChange={onWidth} className="preview-widths" />
      {tool ? (
        <SegmentedControl
          label="On the page"
          className="preview-tools"
          value={tool.value}
          onChange={tool.onChange}
          options={[
            { value: "edit", label: "Click to edit", title: `Click text or an image on the page to change it. On a link, Enter edits it and ${keyName("mod") === "⌘" ? "⌘Enter" : "Ctrl+Enter"} follows it.` },
            ...(tool.arrange ? [{ value: "arrange" as const, label: "Arrange", title: "Move, add and remove the page’s sections, and switch their options, right on the page." }] : []),
            { value: "browse", label: "Browse", title: "Click links and buttons as a visitor would." },
          ]}
        />
      ) : null}
      {openUrl ? (
        <a className={buttonClass("quiet", "sm", "g-btn--icon")} href={openUrl} target="_blank" rel="noopener noreferrer" aria-label="Open this page in a new tab" title="Open this page in a new tab">
          <Icon name="external" />
        </a>
      ) : null}
    </div>
  );
}
