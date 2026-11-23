import { useCallback, useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { blockTypeOf } from "@/features/content/form/summary";
import { useStoredState } from "@/features/preview/useStoredState";
import { count } from "@/lib/format";
import { useMeta } from "@/lib/stores/meta";
import { Button, IconButton, ProofMark, Spinner } from "@/ui";
import { Icon } from "@/ui/Icon";
import { positionWords } from "./model";
import { PaletteList } from "./PaletteList";
import { SectionOptions } from "./SectionOptions";
import type { ArrangeController } from "./useArrange";

const NARROW_PX = 760;

/** Whether the preview pane is too narrow to give the panel its own column. */
function useNarrow(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const pane = document.querySelector(".preview");
    if (!pane || typeof ResizeObserver === "undefined") return () => undefined;
    const observer = new ResizeObserver(notify);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  return useSyncExternalStore(subscribe, () => (document.querySelector(".preview")?.getBoundingClientRect().width ?? 1000) < NARROW_PX);
}

export interface ArrangePanelProps {
  siteId: string;
  arrange: ArrangeController;
  /** Show the form (for a page that can't be arranged on the page). */
  onShowForm?: () => void;
}

function Declined({ reason, docsUrl, onShowForm }: { reason: string | null; docsUrl: string; onShowForm?: () => void }) {
  return (
    <div className="builder-note" role="note">
      <p className="builder-note__title">
        <ProofMark kind="bang" />
        <span>Sections can’t be arranged on this page.</span>
      </p>
      <p>This site hasn’t marked its sections for arranging on the page, and they can’t be told apart for certain here. The form’s section list still works: add, move and remove them there.</p>
      <div className="builder-note__actions">
        {onShowForm ? (
          <Button size="sm" variant="secondary" onClick={onShowForm}>
            Show the form
          </Button>
        ) : null}
        <a className="g-link builder-note__link" href={`${docsUrl.replace(/\/+$/, "")}/visual-builder/`} target="_blank" rel="noopener noreferrer">
          How a site marks its sections <Icon name="external" size={12} />
        </a>
      </div>
      {reason ? (
        <details className="app-details builder-note__detail">
          <summary>Technical details</summary>
          <p className="g-mono">{reason}</p>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The Arrange panel beside the page: what the page builder found, the
 * selected section's options, and the palette of section types to drag onto
 * the page (or pick, then place).
 */
export function ArrangePanel({ siteId, arrange, onShowForm }: ArrangePanelProps) {
  // A narrow preview keeps the page in view: the panel starts as a rail there and floats over the page when opened.
  const narrow = useNarrow();
  const [wideCollapsed, setWideCollapsed] = useStoredState<boolean>("galley.arrange.collapsed", false);
  const [narrowOpen, setNarrowOpen] = useState(false);
  const collapsed = narrow ? !narrowOpen : wideCollapsed;
  const setCollapsed = useCallback((value: boolean) => (narrow ? setNarrowOpen(!value) : setWideCollapsed(value)), [narrow, setWideCollapsed]);
  const docsUrl = useMeta((s) => s.meta?.brand.docsUrl) ?? "https://galley.fictiontribe.com/docs";
  const { status, selected, placing, target, editable, fields } = arrange;
  const [searchToken, setSearchToken] = useState(0);

  // A ＋ on the page: open the palette for that place.
  useEffect(() => {
    if (!target) return;
    setCollapsed(false);
    setSearchToken(Date.now());
  }, [target, setCollapsed]);
  useEffect(() => {
    if (arrange.optionsToken) setCollapsed(false);
  }, [arrange.optionsToken, setCollapsed]);

  const field = selected?.field ?? fields[0] ?? null;
  const labels = field ? arrange.labelsOf(field.key) : [];
  const blocks = field?.blocks ?? [];
  const mapped = status.status === "mapped";
  const block = selected ? blockTypeOf(selected.item, selected.field) : undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    if (placing) {
      event.stopPropagation();
      arrange.stopPlacing();
    } else if (target) {
      event.stopPropagation();
      arrange.setTarget(null);
    }
  };

  if (collapsed) {
    return (
      <aside className="builder-panel builder-panel--rail" aria-label="Arrange">
        <IconButton icon="panel-left" label="Show the Arrange panel" tooltipSide="right" onClick={() => setCollapsed(false)} />
        <IconButton
          icon="plus"
          label="Add a section"
          tooltipSide="right"
          disabled={!mapped || !editable}
          onClick={() => {
            setCollapsed(false);
            setSearchToken(Date.now());
          }}
        />
      </aside>
    );
  }

  return (
    <aside className="builder-panel" aria-label="Arrange" onKeyDown={onKeyDown}>
      <div className="builder-panel__head">
        <span className="g-eyebrow">Arrange</span>
        <span className="g-hint builder-panel__count">{field ? count(labels.length, "section") : ""}</span>
        <span className="g-toolbar__spacer" />
        <IconButton icon="panel-left" label="Hide the Arrange panel" tooltipSide="bottom" onClick={() => setCollapsed(true)} />
      </div>
      <div className="builder-panel__body">
        {status.status === "loading" || (status.status === "waiting" && !mapped) ? (
          <p className="builder-panel__status" aria-busy="true">
            <Spinner label="Working" />
            <span>Finding the sections on the page…</span>
          </p>
        ) : status.status === "declined" ? (
          <Declined reason={status.reason} docsUrl={docsUrl} onShowForm={onShowForm} />
        ) : !editable ? (
          <p className="builder-panel__hint">This page can’t be changed here, so its sections stay where they are.</p>
        ) : !selected ? (
          <p className="builder-panel__hint">Click a section on the page to select it. Drag it by its handle to move it, or use ＋ between sections to add one.</p>
        ) : null}

        {mapped && selected && arrange.store ? (
          <section className="builder-panel__selected" aria-label={`${block?.label ?? "Section"}, selected`}>
            <p className="g-eyebrow">
              Selected · {selected.index + 1} of {labels.length}
            </p>
            <div className="builder-panel__title-row">
              <p className="builder-panel__title">{block?.label ?? labels[selected.index] ?? "Section"}</p>
              <Button size="sm" variant="secondary" onClick={() => arrange.editSection(selected.field.key, selected.index)}>
                Edit content
              </Button>
            </div>
            {editable ? (
              <>
                <p className="g-eyebrow builder-panel__sub">Options</p>
                <SectionOptions store={arrange.store} fieldKey={selected.field.key} index={selected.index} item={selected.item} block={block} focusToken={arrange.optionsToken} />
              </>
            ) : null}
          </section>
        ) : null}

        {mapped && editable && field ? (
          <section className="builder-panel__add" aria-label="Add a section">
            <p className="g-eyebrow builder-panel__sub">Add a section</p>
            {placing ? (
              <div className="builder-placing" role="status">
                <p>
                  Choose where <strong>{placing.block.label}</strong> goes: press a ＋ line on the page, or:
                </p>
                <div className="builder-placing__actions">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      arrange.insertAt(placing.block, placing.field, labels.length);
                      arrange.stopPlacing();
                    }}
                  >
                    Add at the end
                  </Button>
                  {selected ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        arrange.insertAt(placing.block, placing.field, selected.index + 1);
                        arrange.stopPlacing();
                      }}
                    >
                      Add after “{labels[selected.index]}”
                    </Button>
                  ) : null}
                  <Button size="sm" variant="quiet" onClick={arrange.stopPlacing}>
                    Not now
                  </Button>
                </div>
              </div>
            ) : target ? (
              <div className="builder-placing" role="status">
                <p>
                  Pick a section to add <strong>{positionWords(labels, target.index)}</strong>.
                </p>
                <div className="builder-placing__actions">
                  <Button size="sm" variant="quiet" onClick={() => arrange.setTarget(null)}>
                    Not now
                  </Button>
                </div>
              </div>
            ) : (
              <p className="builder-panel__hint">Drag one onto the page, or pick one and then choose its place.</p>
            )}
            <PaletteList
              siteId={siteId}
              blocks={blocks}
              layout="rows"
              onPick={arrange.choose}
              onPress={arrange.beginDrag}
              current={placing?.block.type ?? null}
              focusToken={searchToken}
            />
          </section>
        ) : null}
      </div>
      <div className="g-sr" role="status">
        {arrange.note}
      </div>
    </aside>
  );
}
