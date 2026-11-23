import { useEffect, useId, useState, type FormEvent } from "react";
import type { PluginInfo, PluginSettingInfo } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, Field, Input, ProofMark, Select, Toggle } from "@/ui";
import { secretLine, settingProblem } from "./words";
import { applyPluginInfo } from "./usePlugins";

interface SettingProps {
  plugin: PluginInfo;
  setting: PluginSettingInfo;
  siteId?: string;
}

/** Saves some of a plugin's values; `null` removes one. The answer replaces the plugin in the list. */
async function save(plugin: PluginInfo, values: { [key: string]: string | null }, siteId?: string): Promise<PluginInfo> {
  const info = await api("PUT /api/plugins/settings", { body: { name: plugin.name, values, ...(siteId ? { siteId } : {}) } });
  applyPluginInfo(info);
  return info;
}

function useEnvWords(): string {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  return hosted ? "this server’s environment" : "this computer’s environment";
}

/** Supplied by the environment the app started in: shown, never editable. */
function EnvSetting({ setting }: { setting: PluginSettingInfo }) {
  const where = useEnvWords();
  return (
    <div className="plg-setting">
      <div className="plg-setting__row">
        <div className="plg-setting__text">
          <span className="g-label">{setting.label}</span>
          <span className="plg-setting__status">
            <ProofMark kind="reg" className="app-secret__ok" />
            <span>
              Set by {where}
              {setting.secret && setting.hint ? (
                <>
                  {" "}
                  · ends in <span className="g-mono">{setting.hint}</span>
                </>
              ) : null}
              {!setting.secret && setting.value ? (
                <>
                  {" "}
                  · <span className="g-mono">{setting.value}</span>
                </>
              ) : null}
            </span>
          </span>
        </div>
        <Badge mark={null}>Read-only</Badge>
      </div>
      <p className="g-hint">It can’t be changed here. Change it where the app is started, then restart the app.</p>
    </div>
  );
}

/** A secret: write-only. Its status and last four characters, Replace and Remove. */
function SecretSetting({ plugin, setting, siteId }: SettingProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = settingProblem({ ...setting, required: true }, value);
    if (problem) {
      setError(value.trim() ? problem : "Paste it first.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await save(plugin, { [setting.key]: value.trim() }, siteId);
      setValue("");
      setEditing(false);
      notify({ tone: "success", title: `${setting.label} saved`, body: "It’s kept with the app’s own keys and never shown again — only its last four characters." });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      await save(plugin, { [setting.key]: null }, siteId);
      notify({ tone: "neutral", title: `${setting.label} removed` });
    } catch (caught) {
      notify({ tone: "danger", title: `Couldn’t remove the ${setting.label}`, body: errorShape(caught).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="plg-setting">
      <div className="plg-setting__row">
        <div className="plg-setting__text">
          <span className="g-label" id={`${inputId}-label`}>
            {setting.label}
            {setting.required ? null : <span className="g-faint"> · optional</span>}
          </span>
          <span className={setting.configured ? "plg-setting__status" : "plg-setting__status g-faint"}>
            {setting.configured ? <ProofMark kind="reg" className="app-secret__ok" /> : null}
            <span>
              {setting.configured ? (
                <>
                  Set{setting.hint ? " · ends in " : ""}
                  {setting.hint ? <span className="g-mono">{setting.hint}</span> : null}
                </>
              ) : (
                secretLine(setting)
              )}
            </span>
          </span>
        </div>
        {editing ? null : (
          <div className="app-secret__actions">
            {setting.configured ? (
              <Button size="sm" variant="danger-quiet" busy={busy === "remove"} busyLabel="Removing" onClick={() => void remove()} aria-label={`Remove the ${setting.label}`}>
                Remove
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" icon="key" onClick={() => setEditing(true)} aria-label={`${setting.configured ? "Replace" : "Add"} the ${setting.label}`}>
              {setting.configured ? "Replace…" : "Add…"}
            </Button>
          </div>
        )}
      </div>
      {setting.help && !editing ? <p className="g-hint">{setting.help}</p> : null}
      {editing ? (
        <form className="app-secret__form" onSubmit={submit}>
          <Field label={`New ${setting.label}`} hideLabel error={error ?? undefined} hint={setting.help}>
            <Input type="password" mono autoComplete="off" spellCheck={false} placeholder={setting.placeholder ?? "Paste it here"} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
          </Field>
          <div className="app-secret__actions">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setEditing(false);
                setValue("");
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" busy={busy === "save"} busyLabel="Saving">
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** A plain value: shown and edited in place; emptied, it's removed. */
function TextSetting({ plugin, setting, siteId }: SettingProps) {
  const [value, setValue] = useState(setting.value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(setting.value ?? ""), [setting.value]);
  const dirty = value.trim() !== (setting.value ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = settingProblem(setting, value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save(plugin, { [setting.key]: value.trim() ? value.trim() : null }, siteId);
      notify({ tone: "success", title: `${setting.label} saved` });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="plg-setting plg-setting--text" onSubmit={submit}>
      <Field label={setting.label} aside={setting.required ? <span className="plg-required">Required</span> : <span className="g-faint">Optional</span>} error={error ?? undefined} hint={setting.help}>
        <Input mono spellCheck={false} placeholder={setting.placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
      </Field>
      <Button size="sm" variant="secondary" type="submit" disabled={!dirty} busy={busy} busyLabel="Saving">
        Save
      </Button>
    </form>
  );
}

/** Whether a toggle reads as on: what is saved, else its default. */
const isOn = (setting: PluginSettingInfo) => /^(on|yes|true|1)$/i.test((setting.value ?? setting.default ?? "off").trim());

/**
 * An on/off switch, saved the moment it changes, with Undo. A switch that
 * lets the assistant act outside the app (it switches a tool on) is drawn
 * as a decision: its consequence sits beside it in full ink, not as a hint.
 */
function ToggleSetting({ plugin, setting, siteId }: SettingProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = isOn(setting);
  const decision = Boolean(setting.switchesOn?.length);
  const consequence = setting.consequence;

  const set = async (next: boolean, undoable = true) => {
    setBusy(true);
    setError(null);
    try {
      await save(plugin, { [setting.key]: next ? "on" : "off" }, siteId);
      notify({
        tone: "neutral",
        title: next ? "Switched on" : "Switched off",
        body: setting.label,
        ...(undoable ? { action: { label: "Undo", onClick: () => void set(!next, false) } } : {}),
      });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  if (!decision) {
    return (
      <div className="plg-setting">
        <Toggle checked={on} disabled={busy} onChange={(next) => void set(next)} label={setting.label} description={consequence ?? setting.help} />
        {consequence && setting.help ? <p className="g-hint">{setting.help}</p> : null}
        {error ? (
        <p className="g-error-text" role="alert">
          <ProofMark kind="bang" />
          {error}
        </p>
      ) : null}
      </div>
    );
  }
  return (
    <div className={on ? "plg-setting plg-decision plg-decision--on" : "plg-setting plg-decision"}>
      <label className="plg-decision__row">
        <span className="plg-decision__text">
          <span className="plg-decision__label">{setting.label}</span>
          {consequence ? (
            <span className="plg-decision__consequence">
              <ProofMark kind="bang" />
              <span>{consequence}</span>
            </span>
          ) : null}
        </span>
        <span className="plg-decision__state" aria-hidden="true">
          {on ? "On" : "Off"}
        </span>
        <Toggle checked={on} disabled={busy} onChange={(next) => void set(next)} aria-label={setting.label} />
      </label>
      {setting.help ? <p className="g-hint">{setting.help}</p> : null}
      {error ? (
        <p className="g-error-text" role="alert">
          <ProofMark kind="bang" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One of a fixed list of choices, saved the moment it changes. */
function SelectSetting({ plugin, setting, siteId }: SettingProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = setting.value ?? setting.default ?? "";

  const choose = async (next: string) => {
    if (next === current) return;
    setBusy(true);
    setError(null);
    try {
      await save(plugin, { [setting.key]: next || null }, siteId);
      notify({ tone: "success", title: `${setting.label} saved` });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plg-setting">
      <Field label={setting.label} error={error ?? undefined} hint={setting.help}>
        <Select value={current} disabled={busy} options={(setting.options ?? []).map((option) => ({ value: option.value, label: option.label }))} placeholder={setting.default ? undefined : "Choose…"} onChange={(next) => void choose(next)} />
      </Field>
    </div>
  );
}

/** Every setting a plugin declares, drawn from its own declaration. */
export function PluginSettings({ plugin, siteId }: { plugin: PluginInfo; siteId?: string }) {
  if (plugin.settings.length === 0) return null;
  return (
    <div className="plg-settings" role="group" aria-label={`${plugin.displayName} settings`}>
      {plugin.settings.map((setting) =>
        setting.source === "env" ? (
          <EnvSetting key={setting.key} setting={setting} />
        ) : setting.secret ? (
          <SecretSetting key={setting.key} plugin={plugin} setting={setting} siteId={siteId} />
        ) : setting.type === "toggle" ? (
          <ToggleSetting key={setting.key} plugin={plugin} setting={setting} siteId={siteId} />
        ) : setting.type === "select" ? (
          <SelectSetting key={setting.key} plugin={plugin} setting={setting} siteId={siteId} />
        ) : (
          <TextSetting key={setting.key} plugin={plugin} setting={setting} siteId={siteId} />
        ),
      )}
    </div>
  );
}
