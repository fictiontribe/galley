import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { PRODUCT } from "@galley/core/brand";
import type { GalleyConfig, PublishMode, SiteModel } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { count } from "@/lib/format";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Badge, Button, ErrorState, Field, Input, PageHeader, Skeleton, Textarea, Toggle, cx } from "@/ui";
import { OnlineCard } from "@/features/deploy/Online";
import { ConnectionsSection } from "./ConnectionsSection";
import { SitePluginsSummary } from "@/features/plugins/SitePluginsSummary";
import { useScrollToHash } from "@/lib/hashScroll";

type Draft = GalleyConfig;

/** Set a nested key; an empty value removes it, and emptied objects are pruned. */
function withValue(draft: Draft, path: string[], value: string | number | boolean | string[] | undefined): Draft {
  const next = structuredClone(draft) as Record<string, unknown>;
  const parents: Array<Record<string, unknown>> = [next];
  let node = next;
  for (const key of path.slice(0, -1)) {
    const child = node[key];
    node[key] = child && typeof child === "object" && !Array.isArray(child) ? child : {};
    node = node[key] as Record<string, unknown>;
    parents.push(node);
  }
  const leaf = path[path.length - 1] as string;
  const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty) delete node[leaf];
  else node[leaf] = value;
  for (let index = path.length - 2; index >= 0; index--) {
    const parent = parents[index] as Record<string, unknown>;
    const key = path[index] as string;
    const child = parent[key] as Record<string, unknown>;
    if (Object.keys(child).length === 0) delete parent[key];
  }
  return next as Draft;
}

function Group({ id, title, description, children }: { id?: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="app-settings__section" id={id}>
      <header className="app-settings__section-head">
        <h2 className="app-settings__section-title">{title}</h2>
        {description ? <p className="app-settings__section-text">{description}</p> : null}
      </header>
      <div className="app-settings__section-body">{children}</div>
    </section>
  );
}

/**
 * Under a field that overrides detection: what detection found, and a way
 * back to it. Without an override the detected value is the placeholder.
 */
function OverrideHint({ overridden, detected, onClear, hint }: { overridden: boolean; detected: string | null | undefined; onClear: () => void; hint?: ReactNode }) {
  if (!overridden) return hint ?? null;
  return (
    <>
      {detected ? (
        <>
          Detected: <span className="g-mono">{detected}</span>
        </>
      ) : (
        "Nothing was detected"
      )}
      {" · "}
      <button type="button" className="app-link-button" onClick={onClear}>
        Use detected
      </button>
    </>
  );
}

function PublishModeChoice({ value, detected, onChange }: { value: PublishMode | undefined; detected: PublishMode; onChange: (mode: PublishMode | undefined) => void }) {
  const current = value ?? detected;
  const options: Array<{ mode: PublishMode; title: string; body: string }> = [
    { mode: "commit", title: "Publish directly", body: "Pressing Publish makes changes live straight away." },
    { mode: "pull-request", title: "Send for review", body: "Pressing Publish sends the changes to a developer, who approves them before they go live." },
  ];
  return (
    <fieldset className="app-fieldset app-choice-list">
      <legend className="g-label">When someone presses Publish</legend>
      {options.map((option) => (
        <label key={option.mode} className={cx("app-model", current === option.mode && "app-model--checked")}>
          <input type="radio" name="publish-mode" className="app-model__radio" checked={current === option.mode} onChange={() => onChange(option.mode === detected ? undefined : option.mode)} />
          <span className="app-model__text">
            <span className="app-model__name">
              {option.title}
              {option.mode === detected && value === undefined ? <span className="g-faint"> · detected</span> : null}
            </span>
            <span className="app-model__blurb">{option.body}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function SettingsForm({ siteId, model, config }: { siteId: string; model: SiteModel; config: GalleyConfig | null }) {
  // `model` is what detection found, before the settings file is applied.
  const initial = useMemo<Draft>(() => config ?? {}, [config]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [portText, setPortText] = useState(initial.dev?.port?.toString() ?? "");
  const [portError, setPortError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(initial);
    setPortText(initial.dev?.port?.toString() ?? "");
  }, [initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = (path: string[], value: string | number | boolean | string[] | undefined) => setDraft((current) => withValue(current, path, value));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (portError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await api("PUT /api/sites/:siteId/config", { params: { siteId }, body: { config: draft } });
      setQueryData(keys.config(siteId), { config: draft, detected: model });
      invalidate(keys.config(siteId));
      void useSite.getState().refresh();
      notify({ tone: "success", title: "Settings saved", body: `The site now has ${count(next.collections.length, "collection")}. The settings file waits in Proof like any other change.` });
    } catch (caught) {
      setSaveError(caught);
    } finally {
      setSaving(false);
    }
  };

  const instructions = draft.ai?.instructions;
  return (
    <form className="app-settings__sections" onSubmit={save}>
      <Group title="Addresses" description="Where the site is published. The staging address powers the side-by-side comparison in the editor and in Proof: your changes beside what’s on staging now.">
        <Field label="Live site" fieldKey="urls.production" hint={<OverrideHint overridden={draft.urls?.production !== undefined} detected={model.urls.production} onClear={() => set(["urls", "production"], undefined)} hint="The address visitors use" />}>
          <Input type="url" mono value={draft.urls?.production ?? ""} placeholder={model.urls.production ?? "https://www.example.com"} onChange={(event) => set(["urls", "production"], event.target.value.trim())} />
        </Field>
        <Field label="Staging site" fieldKey="urls.staging" hint={<OverrideHint overridden={draft.urls?.staging !== undefined} detected={model.urls.staging} onClear={() => set(["urls", "staging"], undefined)} hint="Optional. Used for comparisons when present; otherwise the live site is used" />}>
          <Input type="url" mono value={draft.urls?.staging ?? ""} placeholder={model.urls.staging ?? "https://staging.example.com"} onChange={(event) => set(["urls", "staging"], event.target.value.trim())} />
        </Field>
      </Group>

      <Group title="Online" description="Where the site is put online and whether publishing puts changes live by itself. Saved as it changes.">
        <OnlineCard siteId={siteId} variant="settings" />
      </Group>

      <Group title="Publishing">
        <PublishModeChoice value={draft.publish?.mode} detected={model.publish.mode} onChange={(mode) => set(["publish", "mode"], mode)} />
      </Group>

      <Group title="Preview" description="How the site’s own dev server is started for the preview.">
        <div className="app-form-row app-form-row--wide-first">
          <Field label="Start command" fieldKey="dev.command" hint={<OverrideHint overridden={draft.dev?.command !== undefined} detected={model.dev?.command} onClear={() => set(["dev", "command"], undefined)} />}>
            <Input mono value={draft.dev?.command ?? ""} placeholder={model.dev?.command ?? "npm run dev"} onChange={(event) => set(["dev", "command"], event.target.value)} />
          </Field>
          <Field
            label="Port"
            fieldKey="dev.port"
            error={portError ?? undefined}
            hint={
              <OverrideHint
                overridden={draft.dev?.port !== undefined}
                detected={model.dev?.port?.toString()}
                onClear={() => {
                  setPortText("");
                  setPortError(null);
                  set(["dev", "port"], undefined);
                }}
              />
            }
          >
            <Input
              mono
              inputMode="numeric"
              value={portText}
              placeholder={model.dev?.port?.toString() ?? "auto"}
              onChange={(event) => {
                const raw = event.target.value.trim();
                setPortText(event.target.value);
                const port = Number(raw);
                if (raw && (!Number.isInteger(port) || port < 1 || port > 65535)) {
                  setPortError("Ports are whole numbers from 1 to 65535.");
                  return;
                }
                setPortError(null);
                set(["dev", "port"], raw ? port : undefined);
              }}
            />
          </Field>
        </div>
      </Group>

      <Group title="Media">
        <div className="app-form-row">
          <Field label="Folder for new images" fieldKey="media.dir" hint={<OverrideHint overridden={draft.media?.dir !== undefined} detected={model.media.dir} onClear={() => set(["media", "dir"], undefined)} />}>
            <Input mono value={draft.media?.dir ?? ""} placeholder={model.media.dir} onChange={(event) => set(["media", "dir"], event.target.value.trim())} />
          </Field>
          <Field label="Served from" fieldKey="media.publicPath" hint={<OverrideHint overridden={draft.media?.publicPath !== undefined} detected={model.media.publicPath} onClear={() => set(["media", "publicPath"], undefined)} hint="The address that folder has on the site" />}>
            <Input mono value={draft.media?.publicPath ?? ""} placeholder={model.media.publicPath} onChange={(event) => set(["media", "publicPath"], event.target.value.trim())} />
          </Field>
        </div>
      </Group>

      <Group id="assistant" title="Assistant" description="Files the assistant reads before every request, such as a style guide or brand voice. One path per line, from the site’s folder.">
        <Field label="Instructions files" fieldKey="ai.instructions" hint={<OverrideHint overridden={instructions !== undefined} detected={model.ai.instructions.join(", ") || null} onClear={() => set(["ai", "instructions"], undefined)} />}>
          <Textarea
            mono
            rows={2}
            value={(instructions ?? []).join("\n")}
            placeholder={model.ai.instructions.join("\n") || "CONTENT-GUIDE.md"}
            onChange={(event) =>
              set(
                ["ai", "instructions"],
                event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
        <Toggle
          checked={draft.ai?.allowBuild ?? model.ai.allowBuild}
          onChange={(checked) => set(["ai", "allowBuild"], checked === model.ai.allowBuild && draft.ai?.allowBuild === undefined ? undefined : checked)}
          label="Allow build mode"
          description="Lets the assistant change the site’s design and code — layouts, components, styles — not just pages and images. Leave off for editors."
        />
      </Group>

      <Group title="Settings file" description="What’s saved: only what differs from what was detected. It lives at the root of the site and is published with it.">
        <div className="app-config-file">
          <div className="app-config-file__head">
            <span className="g-mono">{PRODUCT.configFile}</span>
            {dirty ? <Badge tone="change">Not saved</Badge> : config ? <Badge tone="success">Saved</Badge> : <Badge mark={null}>Not created yet</Badge>}
          </div>
          <pre className="app-config-file__body" aria-label="Settings file contents">
            {Object.keys(draft).length > 0 ? JSON.stringify(draft, null, 2) : "{}  — everything comes from what was detected"}
          </pre>
        </div>
      </Group>

      {saveError ? <ErrorState compact title="Couldn’t save the settings" error={saveError} /> : null}
      <div className="app-savebar">
        <span className="g-hint">{dirty ? "You have unsaved settings." : "Everything is saved."}</span>
        <Button
          variant="quiet"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft(initial);
            setPortText(initial.dev?.port?.toString() ?? "");
            setPortError(null);
          }}
        >
          Reset
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || Boolean(portError)} busy={saving} busyLabel="Saving">
          Save settings
        </Button>
      </div>
    </form>
  );
}

/** /sites/:siteId/settings — overrides on top of detection, written to the site's settings file. */
export function SiteSettingsScreen() {
  const { siteId = "" } = useParams();
  useTopBar({ crumbs: [{ label: "Settings" }] });
  const detail = useSite((s) => s.detail);
  const config = useQuery(keys.config(siteId), () => api("GET /api/sites/:siteId/config", { params: { siteId } }));
  useScrollToHash(Boolean(config.data));
  const [detecting, setDetecting] = useState(false);

  const detect = async () => {
    setDetecting(true);
    try {
      const model = await api("POST /api/sites/:siteId/refresh", { params: { siteId } });
      await useSite.getState().refresh();
      invalidate(keys.site(siteId));
      notify({ tone: "success", title: "Site read again", body: `Found ${count(model.collections.length, "collection")} with ${count(model.collections.reduce((sum, c) => sum + (c.kind === "entries" ? c.count : 0), 0), "page")}.` });
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t read the site again", body: errorShape(caught).message, detail: errorShape(caught).detail });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="app-screen">
      <div className="app-screen__inner">
        <PageHeader
          title="Site settings"
          description="Everything here was worked out from the site itself. Change only what needs correcting; empty fields keep the detected value shown in grey."
          actions={
            <Button variant="secondary" icon="refresh" busy={detecting} busyLabel="Reading the site" onClick={() => void detect()}>
              Detect again
            </Button>
          }
        />
        {!detail || config.loading ? (
          <div aria-busy="true">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} height={120} style={{ marginBlockEnd: "var(--space-6)" }} />
            ))}
          </div>
        ) : config.status === "error" && !config.data ? (
          <ErrorState title="Couldn’t read the site’s settings file" error={config.error} onRetry={() => void config.refetch()} />
        ) : (
          // Older servers send no `detected`; the site's model is the closest stand-in.
          <SettingsForm siteId={siteId} model={config.data?.detected ?? detail.model} config={config.data?.config ?? null} />
        )}
        {/* Saved as it changes, outside the settings file: keys never go into the site. */}
        {detail ? <ConnectionsSection siteId={siteId} /> : null}
        {detail ? <SitePluginsSummary siteId={siteId} /> : null}
      </div>
    </div>
  );
}
