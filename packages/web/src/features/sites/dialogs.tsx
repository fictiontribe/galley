import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SiteGroup, SiteGroupColor, SiteSummary, SiteUsageTotals } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { count, money, relativeTime } from "@/lib/format";
import { notify } from "@/lib/stores/toasts";
import { Button, Dialog, Field, Input, Select, Textarea, cx } from "@/ui";
import { fileSite, siteTarget } from "./actions";
import { AttentionChips, GroupDot, SiteThumb, hostOf } from "./parts";
import { useGroups } from "./store";

export const COLORS: Array<{ value: SiteGroupColor; label: string }> = [
  { value: "ink", label: "Ink" },
  { value: "pencil", label: "Blue pencil" },
  { value: "green", label: "Green" },
  { value: "ochre", label: "Ochre" },
  { value: "rose", label: "Rose" },
  { value: "sky", label: "Sky" },
  { value: "plum", label: "Plum" },
];

/** New group, or rename/recolour one. */
export function GroupDialog({ open, group, onClose, onSaved }: { open: boolean; group: SiteGroup | null; onClose: () => void; onSaved?: (group: SiteGroup) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<SiteGroupColor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setColor(group?.color ?? null);
    setError(null);
  }, [open, group]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = group
        ? await api("PATCH /api/groups/:groupId", { params: { groupId: group.id }, body: { name, ...(color ? { color } : {}) } })
        : await api("POST /api/groups", { body: { name, ...(color ? { color } : {}) } });
      useGroups.getState().put(saved);
      onSaved?.(saved);
      onClose();
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={group ? `Rename ${group.name}` : "New group"}
      description={group ? undefined : "A group keeps one client’s sites together. Sites can move between groups at any time."}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {/* Nothing exists yet when making a group, so there is nothing to keep: the house "Not now". */}
            {group ? "Keep as it is" : "Not now"}
          </Button>
          <Button variant="primary" disabled={!name.trim()} busy={busy} busyLabel="Saving" onClick={() => void save()}>
            {group ? "Save group" : "Create group"}
          </Button>
        </>
      }
    >
      <form
        className="sites-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <Field label="Name" error={error ?? undefined}>
          <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="The client’s name" data-autofocus />
        </Field>
        <Field label="Colour" group>
          <div className="sites-swatches" role="radiogroup" aria-label="Colour">
            {COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={color === option.value}
                aria-label={option.label}
                title={option.label}
                className={cx("sites-swatch", `sites-tone--${option.value}`)}
                onClick={() => setColor(option.value)}
              />
            ))}
          </div>
        </Field>
      </form>
    </Dialog>
  );
}

/** A short note kept with the site ("Dana is the contact; launch 12 March"). */
export function NoteDialog({ site, onClose }: { site: SiteSummary | null; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(site?.note ?? ""), [site]);
  const save = async () => {
    if (!site) return;
    setBusy(true);
    const saved = await fileSite(site, { note: note.trim() || null });
    setBusy(false);
    if (saved) onClose();
  };
  return (
    <Dialog
      open={Boolean(site)}
      onClose={onClose}
      title={site?.note ? `Note on ${site.name}` : `Add a note to ${site?.name ?? "this site"}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {site?.note ? "Keep as it is" : "Not now"}
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Saving" onClick={() => void save()}>
            Save note
          </Button>
        </>
      }
    >
      <Field label="Note" hint="Shown on the Sites screen. Only on this computer.">
        <Textarea value={note} maxLength={500} maxRows={6} onChange={(event) => setNote(event.target.value)} placeholder="Who the contact is, what’s due when…" data-autofocus />
      </Field>
    </Dialog>
  );
}

/** Move a site to another group (or out of every group). */
export function MoveDialog({ site, groups, onClose, onNewGroup }: { site: SiteSummary | null; groups: SiteGroup[]; onClose: () => void; onNewGroup: () => void }) {
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setGroup(site?.group ?? ""), [site]);
  const move = async () => {
    if (!site) return;
    setBusy(true);
    const saved = await fileSite(site, { group: group || null });
    setBusy(false);
    if (saved) {
      const name = groups.find((entry) => entry.id === group)?.name;
      notify({ tone: "neutral", title: name ? `Moved ${site.name} to ${name}` : `${site.name} is in no group now` });
      onClose();
    }
  };
  return (
    <Dialog
      open={Boolean(site)}
      onClose={onClose}
      title={`Move ${site?.name ?? "this site"}`}
      size="sm"
      footer={
        <>
          <Button variant="quiet" onClick={onNewGroup}>
            New group…
          </Button>
          <span className="g-toolbar__spacer" />
          <Button variant="secondary" onClick={onClose}>
            Keep it here
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Moving" disabled={group === (site?.group ?? "")} onClick={() => void move()}>
            Move site
          </Button>
        </>
      }
    >
      <Field label="Group">
        <Select value={group} onChange={setGroup} options={[{ value: "", label: "No group" }, ...groups.map((entry) => ({ value: entry.id, label: entry.name }))]} />
      </Field>
    </Dialog>
  );
}

/** Everything the list knows about one site, with what the assistant has cost on it. */
export function DetailsDialog({ site, group, usage, onClose }: { site: SiteSummary | null; group: SiteGroup | undefined; usage: SiteUsageTotals | undefined; onClose: () => void }) {
  if (!site) return <Dialog open={false} onClose={onClose} title="" />;
  const live = site.facts?.liveUrl;
  const framework = site.framework.version ? `${site.framework.name} ${site.framework.version}` : site.framework.name;
  return (
    <Dialog
      open
      onClose={onClose}
      title={site.name}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {!site.missing ? (
            <Link className="g-btn g-btn--primary" to={siteTarget(site.id)} onClick={onClose}>
              Open site
            </Link>
          ) : null}
        </>
      }
    >
      <div className="sites-details">
        <SiteThumb site={site} group={group} size="card" />
        <dl className="sites-details__facts">
          <dt>Group</dt>
          <dd>
            {group ? (
              <>
                <GroupDot group={group} /> {group.name}
              </>
            ) : (
              "No group"
            )}
          </dd>
          <dt>Waiting</dt>
          <dd>
            <AttentionChips site={site} />
          </dd>
          <dt>Live at</dt>
          <dd>
            {live ? (
              <a className="g-link" href={live} target="_blank" rel="noreferrer">
                {hostOf(live)}
              </a>
            ) : (
              "Not known yet"
            )}
            {site.facts && site.facts.notLive === 0 ? <span className="g-hint"> · Current</span> : null}
          </dd>
          <dt>Assistant use</dt>
          <dd>
            {usage ? (
              <>
                {money(usage.last30.cost)} in the last 30 days <span className="g-hint">· {count(usage.last30.turns, "request")} · {money(usage.allTime.cost)} in all</span>
              </>
            ) : (
              "None yet"
            )}
          </dd>
          <dt>Folder</dt>
          <dd className="g-mono sites-details__path">{site.root}</dd>
          <dt>Kind</dt>
          <dd>{framework}</dd>
          <dt>Opened</dt>
          <dd>{site.lastOpenedAt > 0 ? relativeTime(site.lastOpenedAt) : "Not opened yet"}</dd>
          {site.facts ? (
            <>
              <dt>Checked</dt>
              <dd>{relativeTime(site.facts.checkedAt)}</dd>
            </>
          ) : null}
          {site.note ? (
            <>
              <dt>Note</dt>
              <dd className="sites-details__note">{site.note}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </Dialog>
  );
}
