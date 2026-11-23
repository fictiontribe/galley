import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { cx } from "@/ui";

export interface SheetProps {
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** Address the frame starts at. Later moves go through the frame's own location, so this is read once. */
  src: string;
  title: string;
  /** Pixel width of the page, or null for the full width of the table. */
  width: number | null;
  caption?: ReactNode;
  /** The frame finished loading a page (the host greets its overlay then). */
  onLoad?: () => void;
  /**
   * The frame's name. The site kit keeps a page's third-party scripts inert
   * when its frame's name starts with "galley-preview" (docs/scripts.md), so
   * every frame the app shows a site in carries one.
   */
  name: string;
}

/** One page on the proofing table: the site's own page in a frame, set like a sheet. */
export function Sheet({ frameRef, src, title, width, caption, onLoad, name }: SheetProps) {
  const [initial] = useState(src);
  return (
    <div className="preview-side">
      {caption ? <p className="g-eyebrow preview-side__caption">{caption}</p> : null}
      <div className="g-preview preview-table">
        <div className={cx("g-preview__frame g-crop preview-sheet", width !== null && "preview-sheet--fixed")} style={width !== null ? { inlineSize: width } : undefined}>
          <iframe ref={frameRef} name={name} className="preview-sheet__iframe" src={initial} title={title} onLoad={onLoad} />
        </div>
      </div>
    </div>
  );
}

const STEP = 0.05;
const clamp = (value: number) => Math.min(0.8, Math.max(0.2, value));

/** The divider between the live and proposed pages: drag it, or use ←/→ (Home/End for the ends). */
export function Divider({ ratio, onRatio, stage }: { ratio: number; onRatio: (ratio: number) => void; stage: RefObject<HTMLDivElement | null> }) {
  const dragging = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.classList.add("app-resizing");
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const box = stage.current?.getBoundingClientRect();
    if (box && box.width > 0) onRatio(clamp((event.clientX - box.left) / box.width));
  };
  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.documentElement.classList.remove("app-resizing");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === "ArrowLeft" ? ratio - STEP : event.key === "ArrowRight" ? ratio + STEP : event.key === "Home" ? 0.2 : event.key === "End" ? 0.8 : event.key === "Enter" ? 0.5 : null;
    if (next === null) return;
    event.preventDefault();
    onRatio(clamp(next));
  };

  return (
    <div
      className="preview-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Live site and proposed page"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={`Live site ${Math.round(ratio * 100)}%`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
    >
      <span className="preview-divider__grip" aria-hidden="true" />
    </div>
  );
}
