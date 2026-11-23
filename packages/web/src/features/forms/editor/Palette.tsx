import { useRef, useState } from "react";
import { useForm } from "@/features/content/form/context";
import { Button, Popover, SegmentedControl } from "@/ui";
import { PALETTE, type PaletteItem } from "../logic/fieldTypes";
import { readForm } from "../logic/json";
import { missingTracking, type Touch } from "../logic/tracking";
import { PALETTE_MIME } from "../canvas/useCanvasDrag";
import { useBuilder } from "./builderState";
import { useFieldActions } from "./useFieldActions";

function Tile({ item, onAdd }: { item: PaletteItem; onAdd: () => void }) {
  return (
    <button
      type="button"
      className="kit-tile"
      draggable
      title={item.description}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(PALETTE_MIME, item.kind);
        event.dataTransfer.setData("text/plain", item.label);
      }}
      onClick={onAdd}
    >
      <span className="kit-tile__glyph" aria-hidden="true">
        {item.glyph}
      </span>
      <span className="kit-tile__label">{item.label}</span>
      <span className="g-sr">. {item.description}. Adds it below the selected field.</span>
    </button>
  );
}

function TrackingButton() {
  const { store } = useForm();
  const actions = useFieldActions();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [touch, setTouch] = useState<Touch>("last");
  const missing = open ? missingTracking(readForm(store.getState().data).fields, touch) : [];
  return (
    <>
      <Button ref={anchor} size="sm" variant="secondary" block onClick={() => setOpen(true)} aria-expanded={open}>
        Tracking fields
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement="right-start" aria-label="Tracking fields" className="kit-pop">
        <p className="kit-pop__title">Add tracking fields</p>
        <p className="kit-pop__body">Hidden fields for the five campaign codes (UTM), the page the form was sent from, and the page before it.</p>
        <SegmentedControl
          label="Which visit the campaign codes come from"
          options={[
            { value: "last", label: "Latest visit" },
            { value: "first", label: "First visit" },
          ]}
          value={touch}
          onChange={setTouch}
        />
        <p className="kit-pop__body g-muted">{touch === "first" ? "The codes from the visitor’s first arrival, even weeks before." : "The codes from the visit when the form was sent."}</p>
        <div className="kit-pop__actions">
          <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
            Not now
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={missing.length === 0}
            onClick={() => {
              actions.addMany(missing, "Tracking fields");
              setOpen(false);
            }}
          >
            {missing.length === 0 ? "Already added" : `Add ${missing.length} fields`}
          </Button>
        </div>
      </Popover>
    </>
  );
}

/** Field types to drag onto the canvas or click in (below the selected field, or at the end). */
export function Palette() {
  const { store } = useForm();
  const actions = useFieldActions();
  const selected = useBuilder((s) => s.selected);
  const add = (item: PaletteItem) => {
    const fields = readForm(store.getState().data).fields;
    const at = selected ? fields.findIndex((field) => field.id === selected) : -1;
    actions.add(item.kind, at >= 0 ? at + 1 : undefined);
  };
  return (
    <nav className="kit-palette" aria-label="Field types">
      <p className="g-eyebrow kit-palette__label">Fields</p>
      <div className="kit-palette__tiles">
        {PALETTE.filter((item) => item.group === "fields").map((item) => (
          <Tile key={item.kind} item={item} onAdd={() => add(item)} />
        ))}
      </div>
      <p className="g-eyebrow kit-palette__label">Layout</p>
      <div className="kit-palette__tiles">
        {PALETTE.filter((item) => item.group === "layout").map((item) => (
          <Tile key={`layout-${item.kind}`} item={item} onAdd={() => add(item)} />
        ))}
      </div>
      <p className="g-eyebrow kit-palette__label">Shortcuts</p>
      <TrackingButton />
    </nav>
  );
}
