import { useState, type FormEvent } from "react";
import type { SecretName, SiteConnections, SiteSecretConnection, UsageTotals } from "@galley/core/types";
import { api, errorShape } from "@/lib/api";
import { count, money } from "@/lib/format";
import { setQueryData, useQuery } from "@/lib/query";
import { useHostedInstall } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, ErrorState, Field, Input, Skeleton } from "@/ui";

const LABELS: Record<string, { title: string; what: string; placeholder: string }> = {
  anthropic: { title: "Assistant", what: "The Anthropic API key the assistant uses for this site.", placeholder: "sk-ant-…" },
  openai: { title: "Images (OpenAI)", what: "The OpenAI key image generation uses for this site.", placeholder: "sk-…" },
  google: { title: "Images (Google)", what: "The Google AI key image generation uses for this site.", placeholder: "AIza…" },
  cloudflare: { title: "Cloudflare", what: "The Cloudflare access key used to put this site online.", placeholder: "Cloudflare API token" },
  vercel: { title: "Vercel", what: "The Vercel access key used to put this site online.", placeholder: "Vercel access token" },
};

const connectionsKey = (siteId: string) => ["site", siteId, "connections"] as const;
const usageKey = (siteId: string) => ["site", siteId, "usage"] as const;

function inUseText(secret: SiteSecretConnection): string {
  if (secret.inUse === "site") return `This site’s own key, ending ${secret.hint ?? "…"}`;
  if (secret.inUse === "env") return `The shared key from the environment, ending ${secret.hint ?? "…"}`;
  if (secret.inUse === "shared") return `The shared key, ending ${secret.hint ?? "…"}`;
  return "Not set — neither this site nor the app has one";
}

function SecretRow({ siteId, secret, onChange }: { siteId: string; secret: SiteSecretConnection; onChange: (next: SiteConnections) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = LABELS[secret.name] ?? { title: secret.name, what: "", placeholder: "" };

  const save = async (next: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api("PUT /api/sites/:siteId/secrets/:name", { params: { siteId, name: secret.name }, body: { value: next } });
      onChange(result);
      setEditing(false);
      setValue("");
      notify({ tone: "success", title: next ? `Saved this site’s own ${label.title.toLowerCase()} key` : "This site uses the shared key again" });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) void save(value.trim());
  };

  return (
    <li className="sites-conn">
      <div className="sites-conn__head">
        <span className="sites-conn__title">{label.title}</span>
        <Badge tone={secret.inUse === "site" ? "accent" : "neutral"}>
          {secret.inUse === "site" ? "This site’s own key" : secret.inUse ? "The shared key" : "Not set"}
        </Badge>
      </div>
      <p className="sites-conn__text">{inUseText(secret)}</p>
      {editing ? (
        <form className="sites-conn__form" onSubmit={submit}>
          <Field label={`This site’s own ${label.title.toLowerCase()} key`} hideLabel error={error ?? undefined} hint={label.what}>
            <Input type="password" mono size="sm" autoComplete="off" spellCheck={false} value={value} placeholder={label.placeholder} onChange={(event) => setValue(event.target.value)} autoFocus />
          </Field>
          <Button type="submit" size="sm" variant="primary" disabled={!value.trim()} busy={busy} busyLabel="Saving">
            Save key
          </Button>
          <Button type="button" size="sm" variant="quiet" onClick={() => (setEditing(false), setValue(""), setError(null))}>
            Keep as it is
          </Button>
        </form>
      ) : (
        <div className="sites-conn__actions">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {secret.site.configured ? "Replace this site’s key…" : "Use a key of this site’s own…"}
          </Button>
          {secret.site.configured ? (
            <Button size="sm" variant="quiet" busy={busy} busyLabel="Clearing" onClick={() => void save(null)}>
              Use the shared key
            </Button>
          ) : null}
          {error ? <span className="g-error-text">{error}</span> : null}
        </div>
      )}
    </li>
  );
}

function AuthorRow({ siteId, connections, onChange }: { siteId: string; connections: SiteConnections; onChange: (next: SiteConnections) => void }) {
  const own = connections.author.site;
  const [name, setName] = useState(own?.name ?? "");
  const [email, setEmail] = useState(own?.email ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (author: { name: string; email: string } | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api("PUT /api/sites/:siteId/author", { params: { siteId }, body: { author } });
      onChange(result);
      setEditing(false);
      notify({ tone: "success", title: author ? "Versions of this site will be recorded under that name" : "This site uses the shared author again" });
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="sites-conn">
      <div className="sites-conn__head">
        <span className="sites-conn__title">Publishing author</span>
        <Badge tone={connections.author.inUse === "site" ? "accent" : "neutral"}>{connections.author.inUse === "site" ? "This site’s own" : "The shared author"}</Badge>
      </div>
      <p className="sites-conn__text">
        Each version published from this site is recorded as {connections.author.name ? <strong>{connections.author.name}</strong> : "the computer’s own name"}
        {connections.author.email ? <span className="g-mono"> &lt;{connections.author.email}&gt;</span> : null}.
      </p>
      {editing ? (
        <form
          className="sites-conn__form sites-conn__form--author"
          onSubmit={(event) => {
            event.preventDefault();
            void save({ name: name.trim(), email: email.trim() });
          }}
        >
          <Field label="Name">
            <Input size="sm" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" autoFocus />
          </Field>
          <Field label="Email">
            <Input size="sm" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </Field>
          <Button type="submit" size="sm" variant="primary" disabled={!name.trim() || !email.trim()} busy={busy} busyLabel="Saving">
            Save author
          </Button>
          <Button type="button" size="sm" variant="quiet" onClick={() => setEditing(false)}>
            Keep as it is
          </Button>
          {error ? <span className="g-error-text">{error}</span> : null}
        </form>
      ) : (
        <div className="sites-conn__actions">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {own ? "Change this site’s author…" : "Use an author of this site’s own…"}
          </Button>
          {own ? (
            <Button size="sm" variant="quiet" busy={busy} busyLabel="Clearing" onClick={() => void save(null)}>
              Use the shared author
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

function UsageLine({ label, totals }: { label: string; totals: UsageTotals }) {
  return (
    <div className="sites-usage__cell">
      <span className="g-eyebrow">{label}</span>
      <span className="sites-usage__cost">{money(totals.cost)}</span>
      <span className="g-hint">
        {count(totals.turns, "request")}
        {totals.images ? ` · ${count(totals.images, "image")}` : ""}
      </span>
    </div>
  );
}

/**
 * Site settings › Connections: for each key the site uses, which one is in
 * use ("This site’s own key" / "The shared key") with set and clear, the
 * publishing author, and what the assistant has cost on this site. Keys are
 * sent in and never come back — only whether one is set and its last four
 * characters.
 */
export function ConnectionsSection({ siteId }: { siteId: string }) {
  // A hosted install has one site: its keys and author are the editor's own
  // (App settings, the Install page), so there is no shared one to override.
  const hosted = useHostedInstall();
  const connections = useQuery(connectionsKey(siteId), () => api("GET /api/sites/:siteId/connections", { params: { siteId } }), { enabled: !hosted });
  const usage = useQuery(usageKey(siteId), () => api("GET /api/sites/:siteId/usage", { params: { siteId } }));
  const update = (next: SiteConnections) => setQueryData(connectionsKey(siteId), next);
  const order: SecretName[] = ["anthropic", "openai", "google", "cloudflare", "vercel"];

  return (
    <div className="app-settings__sections sites-connections">
      {hosted ? null : (
      <section className="app-settings__section" id="connections">
        <header className="app-settings__section-head">
          <h2 className="app-settings__section-title">Connections</h2>
          <p className="app-settings__section-text">
            The keys and the author this site uses. Without its own, a site uses the shared ones from App settings — give a site its own when its client pays for their own use. Keys are kept on this computer only.
          </p>
        </header>
        <div className="app-settings__section-body">
          {connections.loading ? (
            <Skeleton height={220} />
          ) : connections.status === "error" && !connections.data ? (
            <ErrorState compact title="Couldn’t load this site’s connections" error={connections.error} onRetry={() => void connections.refetch()} />
          ) : connections.data ? (
            <ul className="sites-conns">
              {[...connections.data.secrets]
                .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
                .map((secret) => (
                  <SecretRow key={secret.name} siteId={siteId} secret={secret} onChange={update} />
                ))}
              <AuthorRow key={connections.data.author.site?.email ?? "shared"} siteId={siteId} connections={connections.data} onChange={update} />
            </ul>
          ) : null}
        </div>
      </section>
      )}
      <section className="app-settings__section" id="site-usage">
        <header className="app-settings__section-head">
          <h2 className="app-settings__section-title">Assistant use</h2>
          <p className="app-settings__section-text">What the assistant has cost on this site at list prices, whichever key paid for it.</p>
        </header>
        <div className="app-settings__section-body">
          {usage.loading ? (
            <Skeleton height={80} />
          ) : usage.data ? (
            <div className="sites-usage">
              <UsageLine label="30 days" totals={usage.data.last30} />
              <UsageLine label="7 days" totals={usage.data.last7} />
              <UsageLine label="All time" totals={usage.data.allTime} />
            </div>
          ) : (
            <ErrorState compact title="Couldn’t load this site’s use" error={usage.error} onRetry={() => void usage.refetch()} />
          )}
        </div>
      </section>
    </div>
  );
}
