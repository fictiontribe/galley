/**
 * Where the redirects take effect, for this site's host: the file the host
 * reads (kept in step by the app, with a link to see it), how full it is
 * against the host's documented limits, a file edited by hand (shown, never
 * overwritten without asking), and for hosts the app can't write for, the
 * downloads. When the host isn't known yet, the one question: where is this
 * site hosted?
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import type { RedirectHostId, RedirectsOverview } from "@galley/core/redirects-info";
import { HOST_INFO } from "@galley/core/redirects-info";
import { api, errorShape, rawFileUrl } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, ConfirmDialog, Dialog, Icon, ProofMark, buttonClass, cx } from "@/ui";
import { exportUrl, setOverview } from "./data";
import { redirectsCount, share } from "./words";

const HOSTS: Array<{ id: RedirectHostId; blurb: string }> = [
  { id: "cloudflare", blurb: "A _redirects file travels with the site." },
  { id: "netlify", blurb: "A _redirects file travels with the site." },
  { id: "vercel", blurb: "The redirects go in vercel.json." },
  { id: "other", blurb: "Download them in the host’s format." },
];

const EXPORTS: Array<{ format: "csv" | "redirects-file" | "vercel-json" | "cloudflare-csv" | "nginx" | "apache"; label: string }> = [
  { format: "csv", label: "Spreadsheet (CSV)" },
  { format: "redirects-file", label: "_redirects file" },
  { format: "vercel-json", label: "Vercel" },
  { format: "cloudflare-csv", label: "Cloudflare list" },
  { format: "nginx", label: "nginx" },
  { format: "apache", label: "Apache (.htaccess)" },
];

async function choose(siteId: string, host: RedirectHostId | null) {
  try {
    setOverview(siteId, await api("PUT /api/sites/:siteId/redirects/settings", { params: { siteId }, body: { host } }));
  } catch (error) {
    const shape = errorShape(error);

    notify({ tone: "danger", title: "Couldn’t save where the site is hosted", body: shape.message, detail: shape.detail });
  }
}

export function HostChooser({ siteId, overview, onDone }: { siteId: string; overview: RedirectsOverview; onDone?: () => void }) {
  const suggested = overview.host.suggestion?.id ?? null;
  const [busy, setBusy] = useState<RedirectHostId | null>(null);

  return (
    <fieldset className="redir-hosts">
      <legend className="redir-panel__title">Where is this site hosted?</legend>
      {overview.host.suggestion ? <p className="g-hint">{overview.host.suggestion.reason}</p> : <p className="g-hint">Redirects take effect through the host’s own file. Choose once; it’s saved with the site.</p>}
      <div className="redir-hosts__options">
        {HOSTS.map((host) => (
          <button
            key={host.id}
            type="button"
            className={cx("redir-host", suggested === host.id && "redir-host--suggested", overview.host.id === host.id && "redir-host--on")}
            aria-pressed={overview.host.id === host.id}
            disabled={busy !== null}
            onClick={() => {
              setBusy(host.id);
              void choose(siteId, host.id).finally(() => {
                setBusy(null);
                onDone?.();
              });
            }}
          >
            <span className="redir-host__name">
              {HOST_INFO[host.id].name}
              {suggested === host.id ? (
                <Badge tone="accent" mark={null}>
                  Looks like it
                </Badge>
              ) : null}
            </span>
            <span className="redir-host__blurb">{host.blurb}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const part = share(used, limit);

  return (
    <div className={cx("redir-meter", part !== null && part >= 1 && used > (limit ?? 0) && "redir-meter--over")}>
      <span className="redir-meter__label">
        {label}
        <span className="g-faint">{limit !== null ? ` ${used.toLocaleString()} of ${limit.toLocaleString()}` : ` ${used.toLocaleString()}`}</span>
      </span>
      {part !== null ? (
        <span className="redir-meter__bar" aria-hidden="true">
          <span style={{ inlineSize: `${Math.max(part * 100, used ? 2 : 0)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

function DerivedState({ siteId, overview, onImport }: { siteId: string; overview: RedirectsOverview; onImport: (path: string) => void }) {
  const derived = overview.derived!;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const replace = async () => {
    setBusy(true);
    try {
      setOverview(siteId, await api("POST /api/sites/:siteId/redirects/derived/replace", { params: { siteId } }));
      setOpen(false);
      notify({ tone: "success", title: "Replaced from the list", body: "The change is waiting in Proof." });
    } catch (error) {
      const shape = errorShape(error);

      notify({ tone: "danger", title: "Couldn’t replace the file", body: shape.message, detail: shape.detail });
    } finally {
      setBusy(false);
    }
  };
  const words: Record<typeof derived.state, { tone: "success" | "warning" | "neutral"; text: string }> = {
    "in-step": { tone: "success", text: "In step with the list" },
    stale: { tone: "warning", text: "Behind the list — changed outside the app" },
    "hand-edited": { tone: "warning", text: "Changed by hand" },
    foreign: { tone: "warning", text: "The site’s own file" },
    missing: { tone: "neutral", text: "Written when the first redirect is added" },
  };
  const word = words[derived.state];

  return (
    <div className="redir-derived">
      <p className="redir-derived__file">
        <span className="g-mono">{derived.path}</span>
        {derived.state !== "missing" ? (
          <a className="app-link-button" href={rawFileUrl(siteId, derived.path)} target="_blank" rel="noopener noreferrer">
            View it <Icon name="external" />
          </a>
        ) : null}
      </p>
      <p className={`redir-derived__state redir-derived__state--${word.tone}`}>
        <ProofMark kind={word.tone === "success" ? "reg" : word.tone === "warning" ? "bang" : "stet"} /> {word.text}
      </p>
      {derived.state === "stale" ? (
        <Button size="sm" variant="secondary" busy={busy} busyLabel="Updating…" onClick={() => void replace()}>
          Bring it up to date
        </Button>
      ) : null}
      {derived.state === "hand-edited" || derived.state === "foreign" ? (
        <>
          <p className="g-hint">
            {derived.state === "foreign" ? "The site already had this file, so it was left as it is. The list isn’t in it yet." : "Someone edited this file by hand since the app wrote it, so it wasn’t replaced."}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Review the difference…
          </Button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            size="xl"
            title={derived.state === "foreign" ? `${derived.path} isn’t from the list yet` : `${derived.path} was changed by hand`}
            description="The left is the file now; the right is what the list would make it. Bring its redirects into the list first if any of them should stay."
            footer={
              <>
                <Button variant="secondary" onClick={() => (setOpen(false), onImport(derived.path))}>
                  Bring its redirects into the list…
                </Button>
                <Button variant="primary" busy={busy} busyLabel="Replacing…" onClick={() => void replace()}>
                  Replace it with the list
                </Button>
              </>
            }
          >
            <div className="redir-compare">
              <div>
                <p className="g-eyebrow">Now</p>
                <pre className="redir-compare__text g-mono">{derived.current}</pre>
              </div>
              <div>
                <p className="g-eyebrow">From the list</p>
                <pre className="redir-compare__text g-mono">{derived.proposed}</pre>
              </div>
            </div>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

export function WhereCard({ siteId, overview, onImport, onCloudflare }: { siteId: string; overview: RedirectsOverview; onImport: (path: string) => void; onCloudflare: () => void }) {
  const [changing, setChanging] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const host = overview.host.id;
  const info = overview.hostInfo;

  if (!host || changing) {
    return (
      <section className="app-card app-card--pad redir-panel">
        <HostChooser siteId={siteId} overview={overview} onDone={() => setChanging(false)} />
        {changing ? (
          <Button size="sm" variant="quiet" onClick={() => setChanging(false)}>
            Keep {HOST_INFO[host!].name}
          </Button>
        ) : null}
      </section>
    );
  }
  const usage = overview.usage;
  const cloudflare = overview.cloudflare;

  return (
    <section className="app-card app-card--pad redir-panel" aria-labelledby="redir-where-title">
      <h2 id="redir-where-title" className="redir-panel__title">
        Where they take effect
      </h2>
      <p className="redir-where__host">
        <strong>{info!.name}</strong>
        {overview.host.from === "deploy" ? (
          <span className="g-faint">
            {" · from the "}
            <Link to={`/sites/${siteId}/online`}>Online settings</Link>
          </span>
        ) : (
          <button type="button" className="app-link-button" onClick={() => setChanging(true)}>
            Change
          </button>
        )}
      </p>
      <p className="redir-where__how">{info!.howItWorks}</p>
      {overview.derived ? <DerivedState siteId={siteId} overview={overview} onImport={onImport} /> : null}
      {usage && (info!.limits.static !== null || info!.limits.total !== null) ? (
        <div className="redir-meters">
          {info!.limits.static !== null ? <Meter label="Exact addresses" used={usage.static} limit={info!.limits.static} /> : null}
          {info!.limits.dynamic !== null ? <Meter label="Wildcards" used={usage.dynamic} limit={info!.limits.dynamic} /> : null}
          {info!.limits.static === null && info!.limits.total !== null ? <Meter label="Redirects" used={usage.total} limit={info!.limits.total} /> : null}
        </div>
      ) : null}
      {usage?.leftOut.length ? <p className="g-hint">{`${usage.leftOut.length.toLocaleString()} can’t go in ${info!.name}’s file: ${usage.leftOut[0]!.reason}`}</p> : null}
      {usage?.over ? (
        <p className="redir-where__over" role="status">
          <ProofMark kind="bang" /> More than {info!.name}’s file takes. {host === "cloudflare" ? "Set them on Cloudflare to cover the whole list." : "Some won’t work until the list is shorter."}
        </p>
      ) : null}
      {overview.leftovers.map((leftover) => (
        <p key={leftover.path} className="redir-where__leftover">
          <span>
            The redirect file for {HOST_INFO[leftover.host].name}, <span className="g-mono">{leftover.path}</span>, is still in the site.
          </span>
          <Button size="sm" variant="quiet" onClick={() => setRemoving(leftover.path)}>
            Remove it
          </Button>
        </p>
      ))}
      {host === "other" ? (
        <div className="redir-exports">
          <p className="g-hint">This app can’t write redirects for this host. Download them in its format and add them where its documentation says.</p>
          <ul>
            {EXPORTS.map((item) => (
              <li key={item.format}>
                <a className={buttonClass("secondary", "sm")} href={exportUrl(siteId, item.format)} download>
                  <Icon name="download" /> {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="redir-where__docs">
        <summary>What {info!.name} does with them</summary>
        <ul>
          <li>{info!.queryStrings}</li>
          <li>{info!.trailingSlash}</li>
          <li>{info!.caseSensitivity}</li>
          {info!.docs.map((doc) => (
            <li key={doc.url}>
              <a href={doc.url} target="_blank" rel="noopener noreferrer">
                {doc.title}
              </a>
            </li>
          ))}
        </ul>
      </details>
      {cloudflare ? (
        <div className="redir-cf">
          <h3 className="redir-cf__title">Also set them on Cloudflare</h3>
          <p className="redir-cf__text">{cloudflare.reason}</p>
          {cloudflare.last ? (
            <p className={cx("redir-cf__last", cloudflare.outOfDate && "redir-cf__last--behind")}>
              <ProofMark kind={cloudflare.outOfDate ? "bang" : "reg"} />
              {` Set on Cloudflare ${relativeTime(cloudflare.last.appliedAt)}${cloudflare.last.who ? ` by ${cloudflare.last.who}` : ""} · ${redirectsCount(cloudflare.last.items)} for ${cloudflare.last.hostnames.join(", ")}`}
              {cloudflare.outOfDate ? ". The list has changed since." : "."}
            </p>
          ) : null}
          <Button size="sm" variant={cloudflare.recommended || cloudflare.outOfDate ? "primary" : "secondary"} icon="globe" onClick={onCloudflare}>
            {cloudflare.last ? "Update on Cloudflare…" : "Set them on Cloudflare…"}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing ?? ""}?`}
        body="This app wrote it for a host the site no longer uses. Removing it is a pending change you can discard in Proof."
        confirmLabel="Remove it"
        cancelLabel="Keep it"
        onConfirm={async () => {
          if (!removing) return;
          setOverview(siteId, await api("POST /api/sites/:siteId/redirects/leftover/remove", { params: { siteId }, body: { path: removing } }));
        }}
      />
    </section>
  );
}
