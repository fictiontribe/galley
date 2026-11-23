import { useRef, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { FormDestination, FormField } from "@galley/core/kit";
import { FormIcon } from "@/ui/form/FormIcon";
import { ToolButton } from "@/ui/form/ToolButton";
import { useMeta } from "@/lib/stores/meta";
import { CaptureReachNote } from "@/features/inbox/ReachNote";
import { BoundToggle } from "../file/Bound";
import { Badge, IconButton, ProofMark, cx } from "@/ui";
import { settingText } from "../logic/json";
import { providerInfo, providerName } from "../logic/providers";
import { inactiveKindLine } from "@/features/plugins/catalog";
import { settingsReady } from "../logic/settings";
import { ConditionEditor } from "../inspector/ConditionEditor";
import { Mark, providerMark } from "../file/Mark";
import type { ListDrag } from "../file/useListDrag";
import { ConstantsList } from "./ConstantsList";
import { ImportFields } from "./ImportFields";
import { MappingTable } from "./MappingTable";
import { ProviderSettings } from "./ProviderSettings";

export interface DestinationCardProps {
  siteId: string;
  formId: string;
  /** Whether the form also sends to the inbox (server-side forwarding needs it). */
  hasInbox: boolean;
  index: number;
  total: number;
  destination: FormDestination;
  fields: readonly FormField[];
  drag: ListDrag;
  flashed: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

/**
 * Where inbox submissions appear, and the link to them. Whether visitors can
 * reach the inbox at all is the inbox feature's own note (`CaptureReachNote`).
 */
function InboxNote({ siteId, formId, destination }: { siteId: string; formId: string; destination: FormDestination }) {
  const custom = settingText(destination.settings.endpoint).trim();
  return (
    <div className="kit-inbox-note">
      <p className="g-margin-note kit-note">
        <ProofMark kind="reg" />
        <span>
          {custom ? "Submissions go to the capture address above, and appear in this app’s inbox for the site." : "Submissions appear in this app’s inbox for the site."}{" "}
          <Link className="g-link" to={`/sites/${siteId}/inbox?form=${encodeURIComponent(formId)}`}>
            See submissions
          </Link>
        </span>
      </p>
      {custom ? null : <CaptureReachNote siteId={siteId} />}
    </div>
  );
}

/** "Send from this app": a webhook forwarded by the server after capture, so a secret in it never reaches the page. */
function ServerSideToggle({ index, destination, hasInbox }: { index: number; destination: FormDestination; hasInbox: boolean }) {
  const product = useMeta((s) => s.meta?.brand.productName ?? "this app");
  const on = destination.settings.serverSide === true;
  if (!hasInbox && !on) return null;
  return (
    <div className="kit-insp__group">
      <BoundToggle
        path={["destinations", index, "settings", "serverSide"]}
        label={`Send from ${product}, not from the visitor’s browser`}
        description="For an address that carries a secret. It’s sent once the submission is stored in the inbox, and tried again if it fails. Put a secret kept in the inbox’s capture settings into the address as {{secret:name}}."
      />
      {on && !hasInbox ? (
        <p className="g-margin-note kit-note kit-note--warning" role="status">
          <ProofMark kind="bang" />
          <span>This only sends when the form also sends to the inbox — that’s how the answers reach {product}. Add the Inbox as a destination, or switch this off.</span>
        </p>
      ) : null}
    </div>
  );
}

/** One destination: its provider's settings, the field mapping, fixed values, and an optional condition. */
export function DestinationCard({ siteId, formId, hasInbox, index, total, destination, fields, drag, flashed, onMove, onRemove }: DestinationCardProps) {
  const card = useRef<HTMLElement>(null);
  const info = providerInfo(destination.provider);
  const name = providerName(destination.provider);
  const path = ["destinations", index];
  const onKey = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const to = index + (event.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < total) onMove(index, to);
  };
  const ready = info ? settingsReady(info.settings, destination.settings) : true;
  return (
    <section ref={card} className={cx("g-block kit-dest", flashed && "kit-dest--flash")} aria-labelledby={`dest-${index}-title`} {...drag.card(index)}>
      <header className="g-block__head kit-dest__head" onKeyDown={onKey}>
        <span className="kit-dest__grip" title="Drag to change the order" aria-hidden="true" {...drag.grip(index, () => card.current)}>
          <FormIcon name="grip" />
        </span>
        <Mark text={providerMark(destination.provider)} />
        <span className="kit-dest__titles">
          <span id={`dest-${index}-title`} className="kit-dest__name">
            {name}
          </span>
          <span className="kit-dest__description">{info?.description ?? inactiveKindLine(destination.provider)}</span>
        </span>
        {index === 0 ? (
          <Badge tone="accent" mark={null}>
            Main
          </Badge>
        ) : (
          <Badge tone="neutral" mark={null}>
            Also
          </Badge>
        )}
        <span className="kit-dest__tools">
          <ToolButton icon="arrow-up" label={`Move ${name} up`} aria-keyshortcuts="Alt+ArrowUp" disabled={index === 0} onClick={() => onMove(index, index - 1)} />
          <ToolButton icon="arrow-down" label={`Move ${name} down`} aria-keyshortcuts="Alt+ArrowDown" disabled={index === total - 1} onClick={() => onMove(index, index + 1)} />
          <IconButton icon="trash" label={`Remove ${name}`} onClick={() => onRemove(index)} />
        </span>
      </header>
      <div className="g-block__body kit-dest__body">
        {index === 0 ? <p className="g-hint">The main destination decides whether the visitor sees the thank-you or the error.</p> : null}
        {info && info.settings.length > 0 ? <ProviderSettings path={[...path, "settings"]} specs={info.settings} values={destination.settings} /> : null}
        {info?.docsUrl ? (
          <a className="g-link kit-dest__docs" href={info.docsUrl} target="_blank" rel="noreferrer">
            Where to find these in {name}
          </a>
        ) : null}
        {destination.provider === "galley" ? <InboxNote siteId={siteId} formId={formId} destination={destination} /> : null}
        {destination.provider === "webhook" ? <ServerSideToggle index={index} destination={destination} hasInbox={hasInbox} /> : null}
        {info?.canImportFields ? <ImportFields siteId={siteId} index={index} destination={destination} fields={fields} providerName={name} ready={ready} /> : null}
        <h4 className="kit-dest__section">Field names</h4>
        <MappingTable index={index} destination={destination} fields={fields} providerName={name} />
        <ConstantsList index={index} provider={destination.provider} constants={destination.constants ?? {}} providerName={name} />
        {index > 0 || destination.when ? (
          <ConditionEditor
            path={[...path, "when"]}
            rule={destination.when}
            fields={fields}
            selfId={null}
            allowNot={false}
            label="Only when…"
            addLabel="Send only for some answers"
            hint={`Send to ${name} only when a field has a given answer.`}
          />
        ) : null}
      </div>
    </section>
  );
}
