import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Effort, SecretName, SecretStatus, Settings, SettingsPatch, UsageSummary, UsageTotals } from "@galley/core/types";
import { Link, useNavigate } from "react-router-dom";
import { useTopBar } from "@/app/chrome";
import { chooseTheme, followSettingsTheme } from "@/app/theme";
import { THEME_OPTIONS, themeKeeper, type ThemeSetting } from "@/lib/theme";
import { useScrollToHash } from "@/lib/hashScroll";
import { signOut } from "@/lib/auth";
import { useHostedInstall, useMeta } from "@/lib/stores/meta";
import { useAccount } from "@/lib/may";
import { placeWords } from "@/lib/where";
import { api, errorShape } from "@/lib/api";
import { formatCredits, formatUsdAsCredits, usdToCredits, useManagedAi } from "@/lib/credits";
import { compactNumber, count, money } from "@/lib/format";
import { getQueryState, setQueryData, useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { useUi } from "@/lib/stores/ui";
import { keys } from "@/lib/sync";
import { Badge, Button, ErrorState, Field, Input, PageHeader, ProofMark, SegmentedControl, Select, Skeleton, buttonClass, cx } from "@/ui";
import { PreviewsSection } from "./PreviewsSection";
import { refreshThemes, useServerThemes, useThemeList } from "@/app/look";
import { ThemeField } from "@/features/themes/ThemeField";
import { VideoSettingsSection } from "@/features/media/video/VideoSettingsSection";
import { imageModelFacts, modelOptionLabel } from "@/features/media/video/cost";

const SECTIONS = [
  { id: "assistant", label: "Assistant" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "search-data", label: "Search intelligence" },
  { id: "you", label: "You" },
  { id: "appearance", label: "Theme and appearance" },
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
  search_data: "Live search data",
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

function formatRenewDate(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function AiCreditsSection() {
  const { managed, disabled, manageUrl } = useManagedAi();
  const credits = useQuery(["ai", "credits"], () => api("GET /api/ai/credits"), { enabled: managed && !disabled });

  if (!managed) return null;
  const effectiveDisabled = disabled || Boolean(credits.data?.disabled);
  const linkUrl = credits.data?.manageUrl ?? manageUrl;
  const balance = credits.data?.balance ?? null;

  return (
    <SettingsSection
      id="credits"
      title="AI credits"
      description={
        effectiveDisabled
          ? "AI features are currently switched off for this site."
          : "Included with your Galley Cloud plan and shared across assistant, image, and video tools."
      }
    >
      {effectiveDisabled ? (
        <div className="app-secret" role="status">
          <div className="app-secret__row">
            <div className="app-secret__text">
              <span className="g-label">AI is switched off for this site</span>
              <span className="app-secret__status">
                <ProofMark kind="stet" className="g-faint" />
                <span>A workspace manager can turn AI back on in Galley Cloud.</span>
              </span>
            </div>
            {linkUrl ? (
              <a className={buttonClass("secondary", "sm")} href={linkUrl} target="_blank" rel="noopener noreferrer">
                Open Galley Cloud
              </a>
            ) : null}
          </div>
        </div>
      ) : credits.loading && !credits.data ? (
        <Skeleton height={110} />
      ) : balance ? (
        <>
          {balance.state === "paused" ? (
            <p className="g-margin-note" role="alert">
              <ProofMark kind="bang" />
              <span>
                Your AI credits for this period are used up, so AI is paused until credits renew or more are added.
                {linkUrl ? (
                  <>
                    {" "}
                    <a className="g-link" href={linkUrl} target="_blank" rel="noopener noreferrer">
                      Add credits in Galley Cloud
                    </a>
                  </>
                ) : null}
              </span>
            </p>
          ) : balance.state === "warn80" ? (
            <p className="g-margin-note" role="status">
              <ProofMark kind="bang" />
              <span>
                You’ve used 80% or more of this period’s AI credits.
                {linkUrl ? (
                  <>
                    {" "}
                    <a className="g-link" href={linkUrl} target="_blank" rel="noopener noreferrer">
                      Manage credits in Galley Cloud
                    </a>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}
          <div className="app-usage__totals">
            <div className="app-usage__total">
              <span className="g-eyebrow">Left</span>
              <span className="app-usage__cost">{balance.leftCredits.toLocaleString()}</span>
              <span className="app-usage__sub">~{count(balance.changesLeft, "typical change")} left</span>
            </div>
            <div className="app-usage__total">
              <span className="g-eyebrow">Used</span>
              <span className="app-usage__cost">{balance.usedCredits.toLocaleString()}</span>
              <span className="app-usage__sub">this period</span>
            </div>
            <div className="app-usage__total">
              <span className="g-eyebrow">Included</span>
              <span className="app-usage__cost">{balance.includedCredits.toLocaleString()}</span>
              <span className="app-usage__sub">with your plan</span>
            </div>
            <div className="app-usage__total">
              <span className="g-eyebrow">Top-up</span>
              <span className="app-usage__cost">{balance.topUpCredits.toLocaleString()}</span>
              <span className="app-usage__sub">added credits</span>
            </div>
          </div>
          <div className="app-secret__row">
            <span className="g-hint" style={{ flex: 1 }}>
              {balance.renewsAt ? `Renews on ${formatRenewDate(balance.renewsAt)}.` : "Trial credits don’t renew."}
              {balance.siteLimit
                ? ` Site limit: ${balance.siteLimit.usedCredits.toLocaleString()} of ${formatCredits(balance.siteLimit.limitCredits)} used.`
                : ""}
            </span>
            {linkUrl ? (
              <a className={buttonClass("secondary", "sm")} href={linkUrl} target="_blank" rel="noopener noreferrer">
                Manage credits &amp; AI
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <div className="app-secret">
          <div className="app-secret__row">
            <div className="app-secret__text">
              <span className="g-label">Galley AI credits</span>
              <span className="app-secret__status">
                <ProofMark kind="reg" className="app-secret__ok" />
                <span>Included with your Galley Cloud workspace.</span>
              </span>
            </div>
            {linkUrl ? (
              <a className={buttonClass("secondary", "sm")} href={linkUrl} target="_blank" rel="noopener noreferrer">
                Manage in Galley Cloud
              </a>
            ) : null}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

function AssistantSection({ settings }: { settings: Settings }) {
  const where = useWhere();
  const { managed, creditMillicents, disabled: aiDisabled } = useManagedAi();
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
    <SettingsSection
      id="assistant"
      title="Assistant"
      description={
        managed
          ? aiDisabled
            ? "Switched off for this site."
            : "Included with your Galley AI credits."
          : `Connect the assistant with your own API key. It’s stored ${where} and never sent to the browser.`
      }
    >
      {managed ? (
        <div className="app-secret">
          <div className="app-secret__row">
            <div className="app-secret__text">
              <span className="g-label">Assistant access</span>
              <span className="app-secret__status">
                <ProofMark kind={aiDisabled ? "stet" : "reg"} className={aiDisabled ? "g-faint" : "app-secret__ok"} />
                <span>{aiDisabled ? "Switched off for this site" : "Included with your Galley AI credits"}</span>
              </span>
            </div>
          </div>
        </div>
      ) : anthropic ? (
        <SecretRow secret={anthropic} hint="Find it in your Anthropic console under API keys" />
      ) : null}
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
                {managed
                  ? `${usdToCredits(model.inputPrice, creditMillicents).toLocaleString()} credits to read · ${usdToCredits(model.outputPrice, creditMillicents).toLocaleString()} credits to write`
                  : `$${model.inputPrice} to read · $${model.outputPrice} to write`}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="g-hint" id="model-prices">
        {managed
          ? "Shown in Galley AI credits per million tokens for what the assistant reads and what it writes."
          : "Prices are in US dollars per million tokens — the units the AI service bills in — for what the assistant reads and what it writes."}
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
  const { managed, creditMillicents, disabled: aiDisabled } = useManagedAi();
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
              ...services.map((p) => ({
                value: p.id,
                label: p.configured ? p.label : managed ? (aiDisabled ? `${p.label} (switched off)` : p.label) : `${p.label} (no key)`,
              })),
            ]}
          />
        </Field>
        {provider ? (
          <Field label="Model" hint={imageModelFacts(provider, provider.models.find((model) => model.id === (settings.images.model ?? provider.defaultModel))) || undefined}>
            <Select
              value={settings.images.model ?? provider.defaultModel}
              onChange={(model) => void save({ images: { model } })}
              options={provider.models.map((model) => ({ value: model.id, label: modelOptionLabel(model, managed ? creditMillicents : undefined) }))}
            />
          </Field>
        ) : null}
      </div>
      {provider ? (
        managed ? (
          <p className="app-images-note">
            <ProofMark kind={aiDisabled ? "stet" : "reg"} className={aiDisabled ? "g-faint" : "app-secret__ok"} />
            <span>{aiDisabled ? "Switched off for this site." : "Included with your Galley AI credits."}</span>
          </p>
        ) : provider.configured ? (
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
      {managed ? null : imageSecrets.map((secret) => <SecretRow key={secret.name} secret={secret} />)}
    </SettingsSection>
  );
}

function SearchDataSettingsSection({ settings }: { settings: Settings }) {
  const where = useWhere();
  const searchDataMeta = useMeta((s) => s.meta?.searchData);
  const managed = Boolean(searchDataMeta?.managed);
  const disabled = Boolean(searchDataMeta?.managed && searchDataMeta?.disabled);
  const secret = settings.secrets.find((item) => item.name === "search_data");

  return (
    <SettingsSection
      id="search-data"
      title="Search intelligence"
      description={
        managed
          ? disabled
            ? "Switched off for this site."
            : "Live rankings, keyword research, competitor gaps, backlinks, and AI answer citations are included with your Galley Cloud plan."
          : `Connect your own live search data credentials to unlock rankings, keyword research, competitor gaps, backlinks, and AI citations. Stored ${where} only.`
      }
    >
      {managed ? (
        <div className="app-secret">
          <div className="app-secret__row">
            <div className="app-secret__text">
              <span className="g-label">Live search data</span>
              <span className="app-secret__status">
                <ProofMark kind={disabled ? "stet" : "reg"} className={disabled ? "g-faint" : "app-secret__ok"} />
                <span>{disabled ? "Switched off for this site" : "Included in plan"}</span>
              </span>
            </div>
            {disabled ? null : <Badge tone="success">Included in plan</Badge>}
          </div>
        </div>
      ) : secret ? (
        <SecretRow
          secret={secret}
          hint="API key (login:password or base64) for rankings, keyword research, competitor gaps, backlinks, and AI citations"
        />
      ) : null}
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

/** With accounts, each person publishes under their own name: it lives in Your account, not here. */
function AccountAuthor() {
  const account = useAccount();
  if (!account) return null;
  return (
    <SettingsSection id="you" title="You" description="Each version is recorded with the name and e-mail of the person who published it, shown in Version history.">
      <p>
        Yours is {account.name || "not set yet"}
        {account.email ? <span className="g-mono"> &lt;{account.email}&gt;</span> : null}. Change it in{" "}
        <Link className="g-link" to="/account">
          Your account
        </Link>
        .
      </p>
    </SettingsSection>
  );
}

function YouSection({ settings }: { settings: Settings }) {
  const hosted = useHostedInstall();
  const account = useAccount();
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
  if (account) return <AccountAuthor />;

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

/**
 * The theme (Quiet, Plate, Desk or one made here) and the appearance (light,
 * dark or the system's). In local mode and the desktop app both are the
 * computer's, saved with these settings so every window agrees. On a hosted
 * install each person keeps their own, in their browser; what is saved here
 * is what someone starts with until they choose (lib/theme.ts, lib/themes).
 */
function AppearanceSection({ settings }: { settings: Settings }) {
  const theme = useUi((s) => s.theme);
  const hosted = useMeta((s) => themeKeeper(s.meta) === "browser");
  const [savingDefault, setSavingDefault] = useState(false);
  const [savingLook, setSavingLook] = useState(false);
  const themes = useThemeList().filter((entry) => entry.origin === "builtin" || entry.origin === "saved" || entry.origin === "plugin");
  const defaultId = useServerThemes().data.defaultId;
  return (
    <SettingsSection
      id="appearance"
      title="Theme and appearance"
      description={hosted ? "Each person chooses their own theme and appearance, kept in their browser. The two switches at the foot of the sidebar change them too." : "The two switches at the foot of the sidebar change them too."}
    >
      <ThemeField hint={hosted ? "Yours, kept in this browser" : "For this app"} />
      <Field label="Appearance" group hint={hosted ? "Kept in this browser. Match my system follows your computer’s light or dark setting" : "Match my system follows your computer’s light or dark setting"}>
        <SegmentedControl<ThemeSetting> label="Appearance" value={theme} options={[...THEME_OPTIONS]} onChange={chooseTheme} />
      </Field>
      {hosted ? (
        <>
          <Field label="Theme for someone new" hint="What a person sees until they choose their own, the sign-in screen included">
            <Select
              value={defaultId}
              disabled={savingLook}
              options={themes.map((entry) => ({ value: entry.theme.id, label: entry.theme.name }))}
              onChange={(next) => {
                setSavingLook(true);
                patchSettings({ appearance: { look: next } })
                  .then(() => refreshThemes())
                  .catch((caught: unknown) => notify({ tone: "danger", title: "Couldn’t change the default theme", body: errorShape(caught).message }))
                  .finally(() => setSavingLook(false));
              }}
            />
          </Field>
          <Field label="Appearance for someone new" group hint="What a person sees until they choose their own">
            <SegmentedControl<ThemeSetting>
              label="Appearance for someone new"
              value={settings.appearance.theme}
              options={THEME_OPTIONS.map((option) => ({ ...option, disabled: savingDefault }))}
              onChange={(next) => {
                setSavingDefault(true);
                patchSettings({ appearance: { theme: next } })
                  .then(followSettingsTheme)
                  .catch((caught: unknown) => notify({ tone: "danger", title: "Couldn’t save the appearance", body: errorShape(caught).message }))
                  .finally(() => setSavingDefault(false));
              }}
            />
          </Field>
        </>
      ) : null}
    </SettingsSection>
  );
}

/** "3 images, $0.04" (or "3 images, 16 credits" in managed mode). */
function mediaLine(made: number, noun: string, cost: number | undefined, managed: boolean, creditMillicents: number): string {
  return `${count(made, noun)}${cost ? `, ${managed ? formatUsdAsCredits(cost, creditMillicents) : money(cost)}` : ""}`;
}

function Totals({ label, totals, managed, creditMillicents }: { label: string; totals: UsageTotals; managed: boolean; creditMillicents: number }) {
  const unpriced = totals.media?.unpriced ?? 0;
  return (
    <div className="app-usage__total">
      <span className="g-eyebrow">{label}</span>
      <span className="app-usage__cost">{managed ? formatUsdAsCredits(totals.cost, creditMillicents) : money(totals.cost)}</span>
      <span className="app-usage__sub">
        {count(totals.turns, "request")}
        {totals.images ? ` · ${mediaLine(totals.images, "image", totals.media?.images, managed, creditMillicents)}` : ""}
        {totals.videos ? ` · ${mediaLine(totals.videos, "video", totals.media?.videos, managed, creditMillicents)}` : ""}
      </span>
      {unpriced > 0 ? <span className="app-usage__sub g-faint">{`${count(unpriced, "generation")} with no price reported, not counted`}</span> : null}
    </div>
  );
}

function DayBars({ days, managed, creditMillicents }: { days: UsageSummary["days"]; managed: boolean; creditMillicents: number }) {
  const max = Math.max(0.0001, ...days.map((day) => day.cost ?? 0));
  const label = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <figure className="app-bars">
      <figcaption className="g-eyebrow">Last 14 days</figcaption>
      <div className="app-bars__plot" role="list" aria-label={managed ? "Credits per day" : "Spend per day"}>
        {days.map((day) => {
          const height = day.cost ? Math.max(3, (day.cost / max) * 100) : 0;
          const formatted = managed ? formatUsdAsCredits(day.cost, creditMillicents) : money(day.cost);
          const barText = day.cost ? (managed ? usdToCredits(day.cost, creditMillicents).toLocaleString() : money(day.cost)) : "";
          return (
            <div key={day.date} className="app-bars__col" role="listitem" aria-label={`${label(day.date)}: ${formatted}, ${count(day.requests, "request")}`}>
              <span className="app-bars__value">{barText}</span>
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
  const { managed, creditMillicents } = useManagedAi();
  const usage = useQuery(keys.usage(), () => api("GET /api/usage"));
  return (
    <SettingsSection
      id="usage"
      title="Usage"
      description={
        managed
          ? `What the assistant, image, and video tools have used in Galley AI credits, ${hosted ? "in this editor" : "on this computer"}.`
          : `What the assistant has cost at list prices, with what image and video services reported for their work, ${hosted ? "in this editor" : "on this computer"}.`
      }
    >
      {usage.loading ? (
        <Skeleton height={160} />
      ) : usage.status === "error" && !usage.data ? (
        <ErrorState compact title="Couldn’t load usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : usage.data ? (
        <>
          <div className="app-usage__totals">
            <Totals label="Today" totals={usage.data.today} managed={managed} creditMillicents={creditMillicents} />
            <Totals label="7 days" totals={usage.data.last7} managed={managed} creditMillicents={creditMillicents} />
            <Totals label="30 days" totals={usage.data.last30} managed={managed} creditMillicents={creditMillicents} />
            <Totals label="All time" totals={usage.data.allTime} managed={managed} creditMillicents={creditMillicents} />
          </div>
          <DayBars days={usage.data.days} managed={managed} creditMillicents={creditMillicents} />
          {usage.data.byModel.length > 0 ? (
            <table className="app-table">
              <caption className="g-sr">Usage by model</caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Read</th>
                  <th scope="col">Written</th>
                  <th scope="col">{managed ? "Credits" : "Cost"}</th>
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
                    <td>{managed ? formatUsdAsCredits(row.cost, creditMillicents) : money(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {usage.data.byModel.length > 0 ? (
            <p className="g-hint">
              {managed ? "Read and written are counted in tokens." : "Read and written are counted in tokens, the units the AI service bills in."}
            </p>
          ) : null}
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
  const { managed } = useManagedAi();
  // Preview limits share a computer between many sites' previews; a hosted install runs one.
  const baseSections = install ? SECTIONS.filter((section) => section.id !== "previews") : SECTIONS;
  const sections = managed ? [{ id: "credits", label: "AI credits" } as const, ...baseSections] : baseSections;
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
                <AiCreditsSection />
                <AssistantSection settings={settings.data} />
                <ImagesSection settings={settings.data} />
                <VideoSettingsSection />
                <SearchDataSettingsSection settings={settings.data} />
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
