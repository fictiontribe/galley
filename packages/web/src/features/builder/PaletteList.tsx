import { useEffect, useId, useMemo, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { BlockType } from "@galley/core/types";
import { rawFileUrl } from "@/lib/api";
import { Icon, Input, cx } from "@/ui";
import { fieldSummary, groupBlocks, searchBlocks } from "./model";
import "./builder.css";

/** A section type's picture, loaded lazily through the site's own files; a set-page card when there is none. */
export function SectionThumb({ siteId, block, titled = true }: { siteId: string; block: BlockType; titled?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (block.thumbnail && !failed) {
    return (
      <span className="builder-thumb">
        <img src={rawFileUrl(siteId, block.thumbnail)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="builder-thumb builder-thumb--plain g-crop" aria-hidden="true">
      {titled ? <span className="builder-thumb__title">{block.label}</span> : null}
      <span className="builder-thumb__rules">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

export interface PaletteListProps {
  siteId: string;
  blocks: readonly BlockType[];
  /** "grid": cards in columns (the form's dialog). "rows": one column of compact rows (the Arrange panel). */
  layout: "grid" | "rows";
  onPick: (block: BlockType) => void;
  /** A press on a card that may become a drag onto the page (the Arrange panel). */
  onPress?: (event: PointerEvent, block: BlockType) => void;
  /** The type being placed right now, shown as picked. */
  current?: string | null;
  autoFocus?: boolean;
  /** Focus moves to the search box when this changes (a ＋ on the page was pressed). */
  focusToken?: number;
  disabled?: boolean;
}

/**
 * Every section type the page can hold: picture, label and one line, searchable,
 * grouped only when the site's own labels make groups obvious. One list is
 * used everywhere a section is picked — the form's "Add section" and the
 * Arrange panel — so there is one way to choose.
 */
export function PaletteList({ siteId, blocks, layout, onPick, onPress, current, autoFocus, focusToken, disabled }: PaletteListProps) {
  const id = useId();
  useEffect(() => {
    if (focusToken) document.getElementById(`${id}-search`)?.focus();
  }, [focusToken, id]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => searchBlocks(blocks, query), [blocks, query]);
  const groups = useMemo(() => (query.trim() ? [{ label: null, blocks: shown }] : groupBlocks(shown)), [shown, query]);
  const ordered = groups.flatMap((group) => group.blocks);
  const optionId = (index: number) => `${id}-option-${index}`;

  const pick = (block: BlockType | undefined) => {
    if (!block || disabled) return;
    onPick(block);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + ordered.length) % Math.max(1, ordered.length);
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(ordered[active]);
    }
  };

  let at = -1;
  return (
    <div className={cx("builder-palette", `builder-palette--${layout}`)}>
      <div className="app-palette-search builder-palette__search">
        <Icon name="search" />
        <Input
          id={`${id}-search`}
          data-autofocus={autoFocus || undefined}
          size="sm"
          value={query}
          placeholder="Find a section type…"
          aria-label="Find a section type"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={ordered[active] ? optionId(active) : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="builder-palette__input"
        />
      </div>
      <div className="builder-palette__list" id={`${id}-list`} role="listbox" aria-label="Section types">
        {groups.map((group) => (
          <div key={group.label ?? "all"} role="group" aria-label={group.label ?? undefined} className="builder-palette__group">
            {group.label ? (
              <p className="g-eyebrow builder-palette__heading" aria-hidden="true">
                {group.label}
              </p>
            ) : null}
            {group.blocks.map((block) => {
              at += 1;
              const index = at;
              return (
                <div
                  key={block.type}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={disabled || undefined}
                  aria-current={current === block.type ? "true" : undefined}
                  data-block-type={block.type}
                  className={cx("builder-card", index === active && "builder-card--active", current === block.type && "builder-card--current")}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(block)}
                  onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                    if (!onPress || disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
                    onPress(event.nativeEvent, block);
                  }}
                >
                  <SectionThumb siteId={siteId} block={block} titled={layout === "grid"} />
                  <span className="builder-card__text">
                    <span className="builder-card__label">{block.label}</span>
                    <span className="builder-card__description">{block.description ?? fieldSummary(block)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {ordered.length === 0 ? <p className="builder-palette__empty">No section types match “{query}”.</p> : null}
      </div>
    </div>
  );
}
