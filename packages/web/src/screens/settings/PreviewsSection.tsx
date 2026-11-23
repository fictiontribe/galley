import { useState } from "react";
import type { Settings } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { setQueryData } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Field, Select } from "@/ui";

const RUNNING = [1, 2, 3, 4, 5, 6, 8, 10, 12];
const IDLE = [5, 10, 20, 30, 45, 60, 120, 240];

/**
 * App settings › Previews: how many sites' previews may run at once, and when
 * an unused one is stopped. Each preview is the site's own dev server, so
 * with many sites open these keep the computer responsive.
 */
export function PreviewsSection({ settings }: { settings: Settings }) {
  const limits = settings.previews;
  const [saving, setSaving] = useState(false);
  if (!limits) return null;

  const save = async (patch: { maxRunning?: number; idleMinutes?: number }) => {
    setSaving(true);
    try {
      setQueryData(keys.settings(), await api("PATCH /api/settings", { body: { previews: patch } }));
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t save the preview limits", body: errorShape(caught).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-settings__section" id="previews" aria-labelledby="previews-title">
      <header className="app-settings__section-head">
        <h2 className="app-settings__section-title" id="previews-title">
          Previews
        </h2>
        <p className="app-settings__section-text">
          Each site’s preview is its own dev server. With many sites open, the least recently used ones are stopped to keep this computer quick, and start again when you come back to them.
        </p>
      </header>
      <div className="app-settings__section-body sites-limits">
        <Field label="Running at once" hint="When one more starts, the one used longest ago stops">
          <Select
            value={String(limits.maxRunning)}
            disabled={saving}
            onChange={(value) => void save({ maxRunning: Number(value) })}
            options={RUNNING.map((value) => ({ value: String(value), label: value === 1 ? "1 preview" : `${value} previews` }))}
          />
        </Field>
        <Field label="Stop an unused preview after" hint="Unused: no page viewed in it and no editor open on its site">
          <Select
            value={String(limits.idleMinutes)}
            disabled={saving}
            onChange={(value) => void save({ idleMinutes: Number(value) })}
            options={IDLE.map((value) => ({ value: String(value), label: value < 60 ? `${value} minutes` : value === 60 ? "1 hour" : `${value / 60} hours` }))}
          />
        </Field>
      </div>
    </section>
  );
}
