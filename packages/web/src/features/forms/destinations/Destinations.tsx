import { useRef } from "react";
import { BUILTIN_PLUGIN, useSiteCatalog } from "@/features/plugins/catalog";
import { insertOp } from "@/features/content/form/ops";
import { planMove, planRemove } from "@/features/content/fields/items/listPlan";
import { useFormValue } from "@/features/content/form/context";
import { notify } from "@/lib/stores/toasts";
import { Button, EmptyState, Menu, type MenuItem } from "@/ui";
import { toJson } from "../logic/json";
import { providerName } from "../logic/providers";
import { AREA_MARKS } from "../logic/marks";
import { useEdits, useFormDoc } from "../file/hooks";
import { useChangeMarks } from "../file/KitFile";
import { useListDrag } from "../file/useListDrag";
import { DestinationCard } from "./DestinationCard";

const PATH = ["destinations"];

/** "Where it goes": every destination receives the submission; the first decides success. */
export function Destinations({ siteId, formId }: { siteId: string; formId: string }) {
  const form = useFormDoc();
  const edits = useEdits();
  const raw = useFormValue(PATH);
  const marks = useChangeMarks();
  const scroller = useRef<HTMLDivElement>(null);
  const list = Array.isArray(raw) ? raw : [];
  const move = (from: number, to: number) => {
    const plan = planMove(PATH, list.length, from, to);
    if (plan) edits.apply(...plan.ops);
  };
  const drag = useListDrag(scroller, move);
  const remove = (index: number) => {
    const plan = planRemove(PATH, list, index);
    if (!plan) return;
    const name = providerName(form.destinations[index]?.provider ?? "Destination");
    edits.apply(...plan.ops);
    notify({ tone: "neutral", title: `${name} removed`, body: "Submissions won’t go there any more.", action: { label: "Undo", onClick: () => edits.apply(...plan.undo) }, duration: 10000 });
  };
  const add = (provider: string) => edits.apply(insertOp(PATH, list.length, toJson({ provider, settings: {} })));
  // Every destination active for the site — the built-in ones and those plugins add, marked with the plugin's name.
  const catalog = useSiteCatalog(siteId);
  const items: MenuItem[] = catalog.formProviders.map((provider) => ({
    id: provider.id,
    label: provider.plugin === BUILTIN_PLUGIN ? providerName(provider.id) : provider.name,
    description: provider.plugin === BUILTIN_PLUGIN ? provider.description : `From the plugin ${catalog.nameOf(provider.plugin)}. ${provider.description}`,
    onSelect: () => add(provider.id),
  }));

  // In the header the button sits at the column's right edge: the menu hangs from that edge so it stays in the column.
  const addButton = (variant: "primary" | "secondary", placement: "bottom-start" | "bottom-end") => (
    <Menu
      label="Destinations"
      items={items}
      placement={placement}
      trigger={(props) => (
        <button {...props} type="button" className={`g-btn g-btn--${variant} g-btn--sm`}>
          Add a destination
        </button>
      )}
    />
  );

  return (
    <div className="kit-tab-body" ref={scroller}>
      <div className="kit-tab-body__inner">
        <header className="kit-tab-head">
          <div>
            <h2 className="kit-tab-head__title">Where it goes</h2>
            <p className="kit-tab-head__lede">Each submission goes to every destination below, in order. The first is the main one.</p>
          </div>
          {form.destinations.length > 0 ? addButton("secondary", "bottom-end") : null}
        </header>
        {form.destinations.length === 0 ? (
          <EmptyState
            compact
            title="Submissions don’t go anywhere yet."
            body="Add the inbox to keep them in this app, or send them to your CRM."
            actions={
              <>
                <Button variant="primary" size="sm" onClick={() => add("galley")}>
                  Use the inbox
                </Button>
                {addButton("secondary", "bottom-start")}
              </>
            }
          />
        ) : (
          <div className="kit-dests">
            {form.destinations.map((destination, index) => (
              <DestinationCard
                key={`${index}-${destination.provider}`}
                siteId={siteId}
                formId={formId}
                hasInbox={form.destinations.some((candidate) => candidate.provider === "galley")}
                index={index}
                total={form.destinations.length}
                destination={destination}
                fields={form.fields}
                drag={drag}
                flashed={marks.has(AREA_MARKS.destinations)}
                onMove={move}
                onRemove={remove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
