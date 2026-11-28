import { useState } from "react";
import type { ScheduledRelease } from "@galley/core/schedules/types";
import { api, errorShape } from "@/lib/api";
import { count, fileName } from "@/lib/format";
import { invalidate } from "@/lib/query";
import { useMay } from "@/lib/may";
import { useChanges } from "@/lib/stores/changes";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Badge, Button, Dialog, Field, Input } from "@/ui";
import {
  activeSchedules,
  combineLocalDateTime,
  formatScheduledTime,
  invalidateSchedules,
  localTimeZone,
  toLocalDateTimeInputs,
  useSchedules,
} from "./useSchedules";

function ScheduleRow({
  siteId,
  item,
  mayPublish,
  onReschedule,
}: {
  siteId: string;
  item: ScheduledRelease;
  mayPublish: boolean;
  onReschedule: (item: ScheduledRelease) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busyAction, setBusyAction] = useState<"run" | "cancel" | null>(null);
  const tz = item.timezone || localTimeZone();

  const runNow = async () => {
    setBusyAction("run");
    try {
      const done = await api("POST /api/sites/:siteId/schedules/:scheduleId/run", {
        params: { siteId, scheduleId: item.id },
      });
      invalidateSchedules(siteId);
      invalidate(["site", siteId, "history"]);
      invalidate(keys.git(siteId));
      void useChanges.getState().refresh();
      void useSite.getState().refresh();
      if (done.state === "failed") {
        notify({ tone: "danger", title: "Couldn’t publish scheduled release", body: done.error ?? "The publish didn’t finish." });
      } else {
        notify({ tone: "success", title: "Published", body: `“${done.message}” is live now.` });
      }
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t publish scheduled release", body: shape.message, detail: shape.detail });
    } finally {
      setBusyAction(null);
    }
  };

  const cancel = async () => {
    setBusyAction("cancel");
    try {
      await api("POST /api/sites/:siteId/schedules/:scheduleId/cancel", {
        params: { siteId, scheduleId: item.id },
        body: { restoreToProof: true },
      });
      invalidateSchedules(siteId);
      void useChanges.getState().refresh();
      notify({
        tone: "success",
        title: "Put back in Proof",
        body: `“${item.message}” is back in Proof as pending changes.`,
      });
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t cancel scheduled release", body: shape.message, detail: shape.detail });
    } finally {
      setBusyAction(null);
    }
  };

  const badgeTone = item.state === "failed" ? "danger" : item.state === "publishing" ? "warning" : "accent";
  const badgeLabel = item.state === "failed" ? "Failed" : item.state === "publishing" ? "Publishing…" : "Scheduled";

  return (
    <li className="scheduled-item">
      <div className="scheduled-item__main">
        <div className="scheduled-item__head">
          <strong className="scheduled-item__title">{item.message}</strong>
          <Badge tone={badgeTone} mark={null}>
            {badgeLabel}
          </Badge>
        </div>
        <p className="scheduled-item__meta">
          <time dateTime={item.scheduledAt}>{formatScheduledTime(item.scheduledAt, tz)}</time>
          <span className="g-faint"> ({tz})</span>
          <span aria-hidden="true"> · </span>
          <span>{item.author.name}</span>
          <span aria-hidden="true"> · </span>
          <button type="button" className="app-link-button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {count(item.files.length, "file")}
          </button>
        </p>
        {item.error ? (
          <p className="scheduled-item__error" role="alert">
            {item.error}
          </p>
        ) : null}
        {expanded ? (
          <ul className="scheduled-item__files">
            {item.files.map((file) => (
              <li key={file.path} className="g-mono">
                <span>{fileName(file.path)}</span>{" "}
                <span className="g-faint">{file.path}</span>{" "}
                <span className="scheduled-item__file-status">({file.status})</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {mayPublish && item.state !== "publishing" ? (
        <div className="scheduled-item__actions">
          <Button size="sm" variant="primary" busy={busyAction === "run"} busyLabel="Publishing…" disabled={busyAction !== null} onClick={() => void runNow()}>
            Publish now
          </Button>
          <Button size="sm" variant="secondary" disabled={busyAction !== null} onClick={() => onReschedule(item)}>
            Reschedule
          </Button>
          <Button size="sm" variant="quiet" busy={busyAction === "cancel"} busyLabel="Restoring…" disabled={busyAction !== null} onClick={() => void cancel()}>
            Put back in Proof
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ScheduledList({ siteId, compact = false }: { siteId: string; compact?: boolean }) {
  const schedules = useSchedules(siteId);
  const mayPublish = useMay()("POST /api/sites/:siteId/schedules");
  const upcoming = activeSchedules(schedules.data?.items);
  const [editing, setEditing] = useState<ScheduledRelease | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);

  if (upcoming.length === 0) return null;

  const openReschedule = (item: ScheduledRelease) => {
    const parts = toLocalDateTimeInputs(item.scheduledAt);
    setDate(parts.date);
    setTime(parts.time);
    setEditing(item);
  };

  const nextIso = combineLocalDateTime(date, time);
  const isFuture = nextIso !== null && Date.parse(nextIso) > Date.now() + 30_000;
  const tz = localTimeZone();

  const saveReschedule = async () => {
    if (!editing || !nextIso || !isFuture) return;
    setSaving(true);
    try {
      const updated = await api("PATCH /api/sites/:siteId/schedules/:scheduleId", {
        params: { siteId, scheduleId: editing.id },
        body: { scheduledAt: nextIso, timezone: tz },
      });
      invalidateSchedules(siteId);
      setEditing(null);
      notify({
        tone: "success",
        title: "Rescheduled",
        body: `“${updated.message}” will go live ${formatScheduledTime(updated.scheduledAt, tz)}.`,
      });
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t reschedule", body: shape.message, detail: shape.detail });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={compact ? "scheduled-panel scheduled-panel--compact" : "scheduled-panel"} aria-labelledby="scheduled-panel-title">
      <div className="scheduled-panel__head">
        <div>
          <p className="g-eyebrow">Scheduled</p>
          <h2 id="scheduled-panel-title" className="scheduled-panel__title">
            {count(upcoming.length, "scheduled release")}
          </h2>
        </div>
        <p className="scheduled-panel__hint">Held safely outside your draft until their publish time arrives.</p>
      </div>
      <ul className="scheduled-panel__list">
        {upcoming.map((item) => (
          <ScheduleRow key={item.id} siteId={siteId} item={item} mayPublish={mayPublish} onReschedule={openReschedule} />
        ))}
      </ul>
      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Reschedule release"
        size="sm"
        dismissible={!saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" busy={saving} busyLabel="Saving…" disabled={!isFuture} onClick={() => void saveReschedule()}>
              Save new time
            </Button>
          </>
        }
      >
        <div className="publish-schedule">
          <div className="publish-schedule__grid">
            <Field label="Publish date">
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label="Publish time">
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </Field>
          </div>
          <p className={isFuture ? "publish-schedule__summary" : "publish-schedule__summary publish-schedule__summary--error"}>
            {nextIso && isFuture
              ? `Goes live ${formatScheduledTime(nextIso, tz)} · ${tz}`
              : "Choose a date and time in the future."}
          </p>
        </div>
      </Dialog>
    </section>
  );
}
