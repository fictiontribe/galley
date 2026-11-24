import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Effort, SecretName, SecretStatus, Settings, SettingsPatch, UsageSummary, UsageTotals } from "@galley/core/types";
import { Link, useNavigate } from "react-router-dom";
import { useTopBar } from "@/app/chrome";
import { useScrollToHash } from "@/lib/hashScroll";
import { signOut } from "@/lib/auth";
import { useHostedInstall, useMeta } from "@/lib/stores/meta";
import { placeWords } from "@/lib/where";
import { api, errorShape } from "@/lib/api";
import { compactNumber, count, money } from "@/lib/format";
import { getQueryState, setQueryData, useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { useUi } from "@/lib/stores/ui";
import { keys } from "@/lib/sync";
import { Badge, Button, ErrorState, Field, Input, PageHeader, ProofMark, SegmentedControl, Select, Skeleton, cx } from "@/ui";
import { PreviewsSection } from "./PreviewsSection";
import { VideoSettingsSection } from "@/features/media/video/VideoSettingsSection";
import { imageModelFacts, modelOptionLabel } from "@/features/media/video/cost";

const SECTIONS = [
  { id: "assistant", label: "Assistant" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "you", label: "You" },
  { id: "appearance", label: "Appearance" },
  { id: "previews", label: "Previews" },
  { id: "usage", label: "Usage" },
] as const;

/** Where keys and generated work are kept: this computer, or — on a hosted install — the server it runs on. */
function useWhere(): string {
  return useHostedInstall() ? "on the server" : "on this computer";
}

const EFFORTS: Array<{ value: Effort; label: string; title: string }> = [
  { value: "low", label: "Quick", title: "Fastest, cheapest; fine for small text changes" },
  { value: "medium", label: "Balanced", title: "Good for most requests" },
  { value: "high", label: "Thorough", title: "Reads more before editing" },
  { value: "xhigh", label: "Most thorough", title: "Best for large or tricky changes; slowest" },
];

const SECRET_LABEL: Record<SecretName, string> = {
  anthropic: "Assistant API key",
  openai: "OpenAI API key",
  google: "Google API key",
  cloudflare: "Cloudflare access key",
  vercel: "Vercel access key",
  fly: "Fly.io access key",
  gcp: "Google Cloud key file",
};

async function patchSettings(patch: SettingsPatch): Promise<Settings> {
  const settings = await api("PATCH /api/settings", { body: patch });
  setQueryData(keys.settings(), settings);
  return settings;
}

function updateSecretInCache(status: SecretStatus): void {
  const current = getQueryState<Settings>(keys.settings()).data;
  if (!current) return;
  setQueryData(keys.settings(), { ...current, secrets: current.secrets.map((secret) => (secret.name === status.name ? status : secret)) });
}

function SettingsSection({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="app-settings__section" id={id} aria-labelledby={`${id}-title`}>
      <header className="app-settings__section-head">
        <h2 className="app-settings__section-title" id={`${id}-title`}>
          {title}
        </h2>
        {description ? <p className="app-settings__section-text">{description}</p> : null}
      </header>
      <div className="app-settings__section-body">{children}</div>
    </section>
  );
}

/** One secret: masked status, and — unless the environment provides it — set / replace / remove. */
function SecretRow({ secret, hint }: { secret: SecretStatus; hint?: string }) {
  const where = useWhere();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("Paste the key first.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      updateSecretInCache(await api("PUT /api/secrets/:name", { params: { name: secret.name }, body: { value: value.trim() } }));
      setValue("");
      setEditing(false);
      notify({ tone: "success", title: "Key saved", body: `It’s stored ${where} only.` });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      updateSecretInCache(await api("PUT /api/secrets/:name", { params: { name: secret.name }, body: { value: null } }));
      notify({ tone: "neutral", title: "Key removed" });
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t remove the key", body: errorShape(caught).message });
    } finally {
      setBusy(null);
    }
  };

  const status = secret.configured ? (
    <span className="app-secret__status">
      <ProofMark kind="reg" className="app-secret__ok" />
      <span>
        Connected · key ending <span className="g-mono">{secret.hint ?? "····"}</span>
        {secret.source === "env" ? " · set when the app was started" : ` · stored ${where}`}
      </span>
    </span>
  ) : (
    <span className="app-secret__status g-faint">Not connected</span>
  );

  return (
    <div className="app-secret">
      <div className="app-secret__row">
        <div className="app-secret__text">
          <span className="g-label">{SECRET_LABEL[secret.name]}</span>
          {status}
        </div>
        {secret.source === "env" ? (
          <Badge mark={null}>Read-only</Badge>
        ) : editing ? null : (
          <div className="app-secret__actions">
            {secret.configured ? (
              <Button size="sm" variant="danger-quiet" busy={busy === "remove"} busyLabel="Removing" onClick={() => void remove()}>
                Remove
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" icon="key" onClick={() => setEditing(true)}>
              {secret.configured ? "Replace…" : "Add key…"}
            </Button>
          </div>
        )}
      </div>
      {secret.source === "env" ? (
        <p className="g-hint">This key comes from the environment the app was started in, so it can’t be changed here. Change it there and restart the app.</p>
      ) : null}
      {editing ? (
        <form className="app-secret__form" onSubmit={save}>
          <Field label={`New ${SECRET_LABEL[secret.name].toLowerCase()}`} hideLabel error={error ?? undefined} hint={hint}>
            <Input type="password" mono autoComplete="off" spellCheck={false} placeholder="Paste the key" value={value} onChange={(event) => setValue(event.target.value)} data-autofocus autoFocus />
          </Field>
          <div className="app-secret__actions">
            <Button size="sm" variant="quiet" onClick={() => { setEditing(false); setValue(""); setError(null); }}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" busy={busy === "save"} busyLabel="Saving">
              Save key
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function AssistantSection({ settings }: { settings: Settings }) {
  const where = useWhere();
  const [saving, setSaving] = useState<string | null>(null);
  const anthropic = settings.secrets.find((secret) => secret.name === "anthropic");
  const set = async (patch: SettingsPatch, what: string) => {
    setSaving(what);
    try {
      await patchSettings(patch);
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t save the setting", body: errorShape(caught).message });
    } finally {
      setSaving(null);
    }
  };
  return (
    <SettingsSection id="assistant" title="Assistant" description={`Connect the assistant with your own API key. It’s stored ${where} and never sent to the browser.`}>
      {anthropic ? <SecretRow secret={anthropic} hint="Find it in your Anthropic console under API keys" /> : null}
      <fieldset className="app-fieldset app-models" aria-busy={saving === "model"} aria-describedby="model-prices">
        <legend className="g-label">Model</legend>
        {settings.ai.models.map((model) => {
          const checked = model.id === settings.ai.model;
          return (
            <label key={model.id} className={cx("app-model", checked && "app-model--checked")}>
              <input type="radio" name="model" className="app-model__radio" checked={checked} onChange={() => void set({ ai: { model: model.id } }, "model")} />
              <span className="app-model__text">
                <span className="app-model__name">{model.label}</span>
                <span className="app-model__blurb">{model.blurb}</span>
              </span>
              <span className="app-model__price">
                ${model.inputPrice} to read · ${model.outputPrice} to write
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="g-hint" id="model-prices">
        Prices are in US dollars per million tokens — the units the AI service bills in — for what the assistant reads and what it writes.
      </p>
      <Field label="Effort" group hint={EFFORTS.find((effort) => effort.value === settings.ai.effort)?.title}>
        <SegmentedControl label="Effort" options={EFFORTS} value={settings.ai.effort} onChange={(effort) => void set({ ai: { effort } }, "effort")} />
      </Field>
    </SettingsSection>
  );
}

/** The built-in generator: labelled placeholder images, no key, always there. */
const PLACEHOLDER_PROVIDER = "mock";
const IMAGE_SECRETS: ReadonlySet<SecretName> = new Set<SecretName>(["openai", "google"]);

function ImagesSection({ settings }: { settings: Settings }) {
  const where = useWhere();
  const services = settings.images.providers.filter((p) => p.id !== PLACEHOLDER_PROVIDER);
  // `null` (or the placeholder generator itself) means the built-in placeholders are used.
  const chosen = settings.images.provider && settings.images.provider !== PLACEHOLDER_PROVIDER ? settings.images.provider : "";
  const provider = services.find((candidate) => candidate.id === chosen);
  const save = (patch: SettingsPatch) =>
    patchSettings(patch).catch((caught: unknown) => notify({ tone: "danger", title: "Couldn’t save the setting", body: errorShape(caught).message }));
  const imageSecrets = settings.secrets.filter((secret) => IMAGE_SECRETS.has(secret.name));

  return (
    <SettingsSection id="images" title="Images" description="Generate images from a description in Media. Without a service, labelled placeholder images are made so layouts can still be tried.">
      <div className="app-form-row">
        <Field label="Provider">
          <Select
            value={chosen}
            onChange={(id) => void save({ images: id ? { provider: id, model: services.find((p) => p.id === id)?.defaultModel ?? null } : { provider: null, model: null } })}
            options={[
              { value: "", label: "Built-in placeholders" },
              ...services.map((p) => ({ value: p.id, label: p.configured ? p.label : `${p.label} (no key)` })),
            ]}
          />
        </Field>
        {provider ? (
          <Field label="Model" hint={imageModelFacts(provider, provider.models.find((model) => model.id === (settings.images.model ?? provider.defaultModel))) || undefined}>
            <Select
              value={settings.images.model ?? provider.defaultModel}
              onChange={(model) => void save({ images: { model } })}
              options={provider.models.map((model) => ({ value: model.id, label: modelOptionLabel(model) }))}
            />
          </Field>
        ) : null}
      </div>
      {provider ? (
        provider.configured ? (
          IMAGE_SECRETS.has(provider.id as SecretName) ? null : (
            <p className="app-images-note">
              <ProofMark kind="reg" className="app-secret__ok" />
              <span>
                {provider.label}’s key is kept with its plugin, on the{" "}
                <Link className="g-link" to="/plugins">
                  Plugins
                </Link>{" "}
                screen.
              </span>
            </p>
          )
        ) : (
          <p className="app-images-note">
            <ProofMark kind="stet" className="g-faint" />
            {/* The app's own image keys are below; a plugin's provider (OpenRouter) keeps its key with the plugin. */}
            {IMAGE_SECRETS.has(provider.id as SecretName) ? (
              <span>{provider.label} needs a key before it can make images. Add one below.</span>
            ) : (
              <span>
                {provider.label} needs its key before it can make images.{" "}
                <Link className="g-link" to="/plugins">
                  Add it in Plugins
                </Link>
              </span>
            )}
          </p>
        )
      ) : (
        <p className="app-images-note">
          <ProofMark kind="reg" className="app-secret__ok" />
          <span>{`Images you generate are placeholders: plain artwork labelled with your description, made ${where}. Choose a service to make real images.`}</span>
        </p>
      )}
      {imageSecrets.map((secret) => (
        <SecretRow key={secret.name} secret={secret} />
      ))}
    </SettingsSection>
  );
}

/**
 * A hosted install's publishing name: one site, so no site-level author to
 * defer to — and when whoever runs the server set it, it can't change here.
 */
function useAuthorFixed(): boolean {
  const hosted = useHostedInstall();
  const install = useQuery(keys.install(), () => api("GET /api/install"), { enabled: hosted });
  return hosted && Boolean(install.data?.fixed.includes("author"));
}

function YouSection({ settings }: { settings: Settings }) {
  const hosted = useHostedInstall();
  const fixed = useAuthorFixed();
  // Nothing saved here yet: the fields start empty, with the computer's own identity as the example — it isn't a choice made here.
  const saved = settings.authorSaved === false ? { name: "", email: "" } : settings.author;
  const machine = settings.authorSaved === false ? settings.author : null;
  const [name, setName] = useState(saved.name);
  const [email, setEmail] = useState(saved.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(saved.name);
    setEmail(saved.email);
  }, [saved.name, saved.email]);
  const dirty = name !== saved.name || email !== saved.email;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      setError("That email address is missing something. It should look like name@example.com.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchSettings({ author: { name: name.trim(), email: email.trim() } });
      notify({ tone: "success", title: "Saved", body: "New versions you publish carry this name." });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      id="you"
      title="You"
      description={
        hosted
          ? "The name and email recorded with each version published from this editor, shown in Version history."
          : "Your name and email appear beside each version you publish, in Version history. A site’s own author (Site settings › Connections) or its own version settings come first."
      }
    >
      {fixed ? (
        <div className="app-form-stack">
          <span>
            {saved.name || settings.author.name} <span className="g-mono">&lt;{saved.email || settings.author.email}&gt;</span>
          </span>
          <span className="g-hint">Set by whoever runs the server, so it can’t be changed here.</span>
        </div>
      ) : (
      <form className="app-form-stack" onSubmit={save}>
        {machine ? <p className="g-hint">{`Not set here yet, so versions use ${placeWords(hosted).machines} name: ${machine.name} (${machine.email}).`}</p> : null}
        <div className="app-form-row">
          <Field label="Name">
            <Input value={name} placeholder={machine?.name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </Field>
          <Field label="Email" error={error ?? undefined}>
            <Input type="email" value={email} placeholder={machine?.email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="primary" size="sm" disabled={!dirty} busy={busy} busyLabel="Saving">
            Save
          </Button>
        </div>
      </form>
      )}
    </SettingsSection>
  );
}

function AppearanceSection({ settings }: { settings: Settings }) {
  const setTheme = useUi((s) => s.setTheme);
  const theme = useUi((s) => s.theme);
  return (
    <SettingsSection id="appearance" title="Appearance">
      <Field label="Theme" group hint="System follows your computer’s light or dark setting">
        <SegmentedControl
          label="Theme"
          value={theme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(next) => {
            // Shown at once; the server's setting is what every window follows.
            setTheme(next);
            if (next === settings.appearance.theme) return;
            patchSettings({ appearance: { theme: next } }).catch((caught: unknown) => {
              setTheme(settings.appearance.theme);
              notify({ tone: "danger", title: "Couldn’t save the theme", body: errorShape(caught).message });
            });
          }}
        />
      </Field>
    </SettingsSection>
  );
}

/** "3 images, $0.04": a kind of generation and what its service reported it cost (that part of the total). */
function mediaLine(made: number, noun: string, cost: number | undefined): string {
  return `${count(made, noun)}${cost ? `, ${money(cost)}` : ""}`;
}

function Totals({ label, totals }: { label: string; totals: UsageTotals }) {
  const unpriced = totals.media?.unpriced ?? 0;
  return (
    <div className="app-usage__total">
      <span className="g-eyebrow">{label}</span>
      <span className="app-usage__cost">{money(totals.cost)}</span>
      <span className="app-usage__sub">
        {count(totals.turns, "request")}
        {totals.images ? ` · ${mediaLine(totals.images, "image", totals.media?.images)}` : ""}
        {totals.videos ? ` · ${mediaLine(totals.videos, "video", totals.media?.videos)}` : ""}
      </span>
      {unpriced > 0 ? <span className="app-usage__sub g-faint">{`${count(unpriced, "generation")} with no price reported, not counted`}</span> : null}
    </div>
  );
}

function DayBars({ days }: { days: UsageSummary["days"] }) {
  const max = Math.max(0.0001, ...days.map((day) => day.cost ?? 0));
  const label = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <figure className="app-bars">
      <figcaption className="g-eyebrow">Last 14 days</figcaption>
      <div className="app-bars__plot" role="list" aria-label="Spend per day">
        {days.map((day) => {
          const height = day.cost ? Math.max(3, (day.cost / max) * 100) : 0;
          return (
            <div key={day.date} className="app-bars__col" role="listitem" aria-label={`${label(day.date)}: ${money(day.cost)}, ${count(day.requests, "request")}`}>
              <span className="app-bars__value">{day.cost ? money(day.cost) : ""}</span>
              <span className="app-bars__bar" style={{ blockSize: `${height}%` }} data-empty={height === 0 || undefined} />
            </div>
          );
        })}
      </div>
      <div className="app-bars__axis" aria-hidden="true">
        <span>{days[0] ? label(days[0].date) : ""}</span>
        <span>{days.at(-1) ? label(days.at(-1)?.date ?? "") : ""}</span>
      </div>
    </figure>
  );
}

function UsageSection() {
  const hosted = useHostedInstall();
  const usage = useQuery(keys.usage(), () => api("GET /api/usage"));
  return (
    <SettingsSection id="usage" title="Usage" description={`What the assistant has cost at list prices, with what image and video services reported for their work, ${hosted ? "in this editor" : "on this computer"}.`}>
      {usage.loading ? (
        <Skeleton height={160} />
      ) : usage.status === "error" && !usage.data ? (
        <ErrorState compact title="Couldn’t load usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : usage.data ? (
        <>
          <div className="app-usage__totals">
            <Totals label="Today" totals={usage.data.today} />
            <Totals label="7 days" totals={usage.data.last7} />
            <Totals label="30 days" totals={usage.data.last30} />
            <Totals label="All time" totals={usage.data.allTime} />
          </div>
          <DayBars days={usage.data.days} />
          {usage.data.byModel.length > 0 ? (
            <table className="app-table">
              <caption className="g-sr">Usage by model</caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Read</th>
                  <th scope="col">Written</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.byModel.map((row) => (
                  <tr key={row.model}>
                    <th scope="row" className="g-mono">
                      {row.model}
                    </th>
                    <td>{row.requests.toLocaleString()}</td>
                    <td>{compactNumber(row.inputTokens)}</td>
                    <td>{compactNumber(row.outputTokens)}</td>
                    <td>{money(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {usage.data.byModel.length > 0 ? <p className="g-hint">Read and written are counted in tokens, the units the AI service bills in.</p> : null}
        </>
      ) : null}
    </SettingsSection>
  );
}

/** /settings — assistant, images, author identity, appearance, usage. */
export function AppSettingsScreen() {
  useTopBar({ crumbs: [{ label: "App settings" }] });
  const settings = useQuery(keys.settings(), () => api("GET /api/settings"));
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const install = useHostedInstall();
  // Preview limits share a computer between many sites' previews; a hosted install runs one.
  const sections = install ? SECTIONS.filter((section) => section.id !== "previews") : SECTIONS;
  useScrollToHash(Boolean(settings.data));
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="app-screen">
      <div className="app-screen__inner app-settings">
        <PageHeader
          title="App settings"
          description={install ? "These apply to this editor." : "These apply to every site you open here."}
          actions={
            hosted ? (
              <Button
                variant="secondary"
                busy={signingOut}
                busyLabel="Signing out"
                onClick={() => {
                  setSigningOut(true);
                  signOut()
                    .then(() => navigate("/login", { replace: true }))
                    .catch((caught: unknown) => notify({ tone: "danger", title: "Couldn’t sign out", body: errorShape(caught).message }))
                    .finally(() => setSigningOut(false));
                }}
              >
                Sign out
              </Button>
            ) : null
          }
        />
        <div className="app-settings__layout">
          <nav className="app-settings__nav" aria-label="Settings sections">
            {sections.map((section) => (
              <a key={section.id} className="g-nav__item" href={`#${section.id}`}>
                {section.label}
              </a>
            ))}
          </nav>
          <div className="app-settings__sections" aria-busy={settings.loading}>
            {settings.loading ? (
              [0, 1, 2].map((index) => <Skeleton key={index} height={140} style={{ marginBlockEnd: "var(--space-6)" }} />)
            ) : settings.status === "error" && !settings.data ? (
              <ErrorState title="Couldn’t load settings" error={settings.error} onRetry={() => void settings.refetch()} />
            ) : settings.data ? (
              <>
                <AssistantSection settings={settings.data} />
                <ImagesSection settings={settings.data} />
                <VideoSettingsSection />
                <YouSection settings={settings.data} />
                <AppearanceSection settings={settings.data} />
                {install ? null : <PreviewsSection settings={settings.data} />}
                <UsageSection />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
