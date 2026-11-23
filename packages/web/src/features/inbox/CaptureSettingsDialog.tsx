/**
 * Capture settings for one site: who may send, who is told, spam protection,
 * the server-to-server key, and forwarding secrets. Stored by the app (never
 * in the site's files); secrets are shown only as "set".
 */
import { useEffect, useState, type ReactNode } from "react";
import type { CaptureSettings, CaptureSettingsPatch, InboxFormSummary } from "@galley/core/api";
import { api, errorShape } from "@/lib/api";
import { setQueryData } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, Dialog, Field, Input, Textarea } from "@/ui";
import { inboxKeys } from "./data";
import { ReachText } from "./ReachNote";

function lines(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="app-capture__section">
      <header className="app-capture__head">
        <h3 className="app-capture__title">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export interface CaptureSettingsDialogProps {
  siteId: string;
  open: boolean;
  onClose: () => void;
  settings: CaptureSettings;
  forms: InboxFormSummary[];
}

export function CaptureSettingsDialog({ siteId, open, onClose, settings, forms }: CaptureSettingsDialogProps) {
  const [origins, setOrigins] = useState("");
  const [notifyDraft, setNotifyDraft] = useState<Record<string, string>>({});
  const [perIp, setPerIp] = useState("");
  const [perForm, setPerForm] = useState("");
  const [turnstile, setTurnstile] = useState("");
  const [secretName, setSecretName] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOrigins(settings.origins.extra.join("\n"));
    setNotifyDraft(Object.fromEntries(forms.map((form) => [form.id, (settings.notify[form.id] ?? []).join(", ")])));
    setPerIp(String(settings.rateLimits.perIpPerMinute));
    setPerForm(String(settings.rateLimits.perFormPerMinute));
    setTurnstile("");
    setShownKey(null);
    setError(null);
    // Only when the dialog opens: typing must not be overwritten by a live refresh.
  }, [open]);

  const patch = async (body: CaptureSettingsPatch, done?: string) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api("PATCH /api/sites/:siteId/capture", { params: { siteId }, body });
      setQueryData(inboxKeys.capture(siteId), next);
      if (done) notify({ tone: "success", title: done });
      return true;
    } catch (failure) {
      setError(errorShape(failure).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const notifyPatch = Object.fromEntries(Object.entries(notifyDraft).map(([formId, text]) => [formId, lines(text)]));
    const ok = await patch(
      { extraOrigins: lines(origins), notify: notifyPatch, rateLimits: { perIpPerMinute: Number(perIp), perFormPerMinute: Number(perForm) } },
      "Capture settings saved",
    );
    if (ok) onClose();
  };

  const key = async (action: "rotate" | "remove") => {
    try {
      const result = await api("POST /api/sites/:siteId/capture/key", { params: { siteId }, body: { action } });
      setQueryData(inboxKeys.capture(siteId), result.settings);
      setShownKey(result.key);
    } catch (failure) {
      setError(errorShape(failure).message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Capture settings"
      description="How this site’s forms reach the inbox. Kept by this app, not published with the site."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep as it was
          </Button>
          <Button variant="primary" busy={saving} busyLabel="Saving…" onClick={() => void save()}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="app-capture">
        {error ? (
          <p className="g-error-text" role="alert">
            {error}
          </p>
        ) : null}
        <Section title="Capture address">
          <ReachText settings={settings} />
        </Section>

        <Section title="Who can send">
          <p className="app-capture__text">
            {settings.origins.site.length ? (
              <>
                The site’s own addresses: <span className="g-mono">{settings.origins.site.join(", ")}</span>.
              </>
            ) : (
              "The site has no live or staging address in its settings yet, so only the addresses below can send."
            )}
            {settings.origins.loopback ? " Previews on this computer can send too." : ""}
          </p>
          <Field label="Other addresses allowed to send" hint="One per line, like https://landing.example.com">
            <Textarea value={origins} onChange={(event) => setOrigins(event.target.value)} rows={2} mono />
          </Field>
        </Section>

        <Section title="E-mail alerts" aside={settings.mail.configured ? <Badge tone="success">Mail is set up</Badge> : <Badge tone="warning">No mail settings</Badge>}>
          {settings.mail.configured ? (
            <p className="app-capture__text">Alerts are sent from {settings.mail.from}.</p>
          ) : (
            <p className="app-capture__text app-capture__text--warning">
              No e-mail can be sent yet: this server has no mail settings. Whoever runs it sets <span className="g-mono">GALLEY_SMTP_URL</span> and <span className="g-mono">GALLEY_MAIL_FROM</span>. Addresses saved here are kept until then.
              {settings.mail.problem ? ` ${settings.mail.problem}` : ""}
            </p>
          )}
          {forms.length === 0 ? <p className="app-capture__text">Add a form to choose who hears about it.</p> : null}
          {forms.map((form) => (
            <Field key={form.id} label={form.name} hint="E-mail addresses, separated by commas">
              <Input value={notifyDraft[form.id] ?? ""} onChange={(event) => setNotifyDraft({ ...notifyDraft, [form.id]: event.target.value })} placeholder="team@example.com" />
            </Field>
          ))}
        </Section>

        <Section title="Spam protection">
          <p className="app-capture__text">A hidden field and a minimum time catch most bots. What they catch goes to Spam, not away.</p>
          <div className="app-capture__pair">
            <Field label="Per visitor, each minute">
              <Input type="number" min={1} max={10000} value={perIp} onChange={(event) => setPerIp(event.target.value)} />
            </Field>
            <Field label="Per form, each minute">
              <Input type="number" min={1} max={10000} value={perForm} onChange={(event) => setPerForm(event.target.value)} />
            </Field>
          </div>
          <Field
            label="Cloudflare Turnstile secret key"
            hint={settings.turnstile.configured ? `Set, ending in ${settings.turnstile.hint}. Forms with a Turnstile site key are checked with it.` : "Only for forms that show the Turnstile check. Its site key goes in the form; the secret goes here."}
            aside={
              settings.turnstile.configured ? (
                <Button size="sm" variant="quiet" onClick={() => void patch({ turnstileSecret: null }, "Turnstile secret removed")}>
                  Remove
                </Button>
              ) : null
            }
          >
            <div className="app-capture__inline">
              <Input type="password" autoComplete="off" value={turnstile} onChange={(event) => setTurnstile(event.target.value)} placeholder={settings.turnstile.configured ? "Paste a new one to replace it" : "0x4AAAA…"} />
              <Button size="sm" variant="secondary" disabled={!turnstile.trim()} onClick={() => void patch({ turnstileSecret: turnstile.trim() }, "Turnstile secret saved").then((ok) => ok && setTurnstile(""))}>
                Save secret
              </Button>
            </div>
          </Field>
        </Section>

        <Section title="Sending from another server" aside={settings.captureKey.enabled ? <Badge tone="success">Key on</Badge> : <Badge>Off</Badge>}>
          <p className="app-capture__text">
            Browsers always say which site they’re on, and only this site’s addresses are let in. A program on a server says nothing, so it needs a key, sent as the <span className="g-mono">X-Capture-Key</span> header.
          </p>
          {shownKey ? (
            <div className="app-capture__key" role="status">
              <p>Copy this key now. It isn’t shown again.</p>
              <code className="g-mono">{shownKey}</code>
              <Button size="sm" variant="secondary" icon="copy" onClick={() => void navigator.clipboard?.writeText(shownKey)}>
                Copy
              </Button>
            </div>
          ) : settings.captureKey.enabled ? (
            <p className="app-capture__text">A key ending in {settings.captureKey.hint} is in use.</p>
          ) : null}
          <div className="app-capture__inline">
            <Button size="sm" variant="secondary" icon="key" onClick={() => void key("rotate")}>
              {settings.captureKey.enabled ? "Make a new key" : "Turn on with a key"}
            </Button>
            {settings.captureKey.enabled ? (
              <Button size="sm" variant="quiet" onClick={() => void key("remove")}>
                Turn off
              </Button>
            ) : null}
          </div>
        </Section>

        <Section title="Forwarding secrets">
          <p className="app-capture__text">
            Values a server-side destination uses without them being in the site’s files: write <span className="g-mono">{"{{secret:name}}"}</span> in its address or a header.
          </p>
          {settings.forwardSecrets.length ? (
            <ul className="app-capture__secrets">
              {settings.forwardSecrets.map((name) => (
                <li key={name}>
                  <span className="g-mono">{name}</span>
                  <Badge tone="success">Set</Badge>
                  <Button size="sm" variant="quiet" onClick={() => void patch({ forwardSecrets: { [name]: null } }, "Secret removed")}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="app-capture__inline">
            <Input size="sm" mono value={secretName} onChange={(event) => setSecretName(event.target.value.toLowerCase())} placeholder="name" aria-label="Secret name" />
            <Input size="sm" type="password" autoComplete="off" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder="value" aria-label="Secret value" />
            <Button
              size="sm"
              variant="secondary"
              disabled={!secretName.trim() || !secretValue}
              onClick={() =>
                void patch({ forwardSecrets: { [secretName.trim()]: secretValue } }, "Secret saved").then((ok) => {
                  if (ok) {
                    setSecretName("");
                    setSecretValue("");
                  }
                })
              }
            >
              Add secret
            </Button>
          </div>
        </Section>
      </div>
    </Dialog>
  );
}
