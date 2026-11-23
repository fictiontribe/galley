import { useEffect, useMemo, useRef, useState } from "react";
import type { AddSitesResult, ScanSitesResult, SiteGroup } from "@galley/core/types";
import { api } from "@/lib/api";
import { Badge, Button, Checkbox, Dialog, ErrorState, Select, Spinner, Tag } from "@/ui";
import { counted } from "./logic";

export interface AddFromFolderDialogProps {
  /** The folder to look in; null keeps the dialog closed. */
  path: string | null;
  groups: SiteGroup[];
  onClose: () => void;
  onAdded: (result: AddSitesResult) => void;
  /** Look somewhere else (opens the folder chooser again). */
  onChooseAnother: () => void;
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * "Add sites from a folder": what was found in the folder (one or two levels
 * down), every new one ticked, added in one go. Nothing is opened or detected
 * in depth; that happens when each site is opened for the first time.
 */
export function AddFromFolderDialog({ path, groups, onClose, onAdded, onChooseAnother }: AddFromFolderDialogProps) {
  const [result, setResult] = useState<ScanSitesResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scanning, setScanning] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const scan = useRef<{ id: string; controller: AbortController } | null>(null);

  const stop = () => {
    const running = scan.current;
    if (!running) return;
    scan.current = null;
    running.controller.abort();
    void api("POST /api/sites/scan/cancel", { body: { id: running.id } }).catch(() => undefined);
    setScanning(false);
  };

  useEffect(() => {
    if (!path) return;
    setResult(null);
    setError(null);
    setGroup("");
    const id = `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    scan.current = { id, controller };
    setScanning(true);
    api("POST /api/sites/scan", { body: { path, id, depth: 2 }, signal: controller.signal })
      .then((found) => {
        if (scan.current?.id !== id) return;
        setResult(found);
        setTicked(new Set(found.sites.filter((site) => !site.known).map((site) => site.path)));
      })
      .catch((caught: unknown) => {
        if (scan.current?.id === id) setError(caught);
      })
      .finally(() => {
        if (scan.current?.id === id) {
          scan.current = null;
          setScanning(false);
        }
      });
    return stop;
  }, [path]);

  const fresh = useMemo(() => result?.sites.filter((site) => !site.known) ?? [], [result]);
  const known = (result?.sites.length ?? 0) - fresh.length;
  const allTicked = fresh.length > 0 && fresh.every((site) => ticked.has(site.path));
  const folderName = path ? lastSegment(path) : "";

  const add = async () => {
    if (ticked.size === 0) return;
    setAdding(true);
    setError(null);
    try {
      const added = await api("POST /api/sites/add", { body: { paths: [...ticked], ...(group ? { group } : {}) } });
      onAdded(added);
    } catch (caught) {
      setError(caught);
    } finally {
      setAdding(false);
    }
  };

  const toggle = (sitePath: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(sitePath);
    else next.delete(sitePath);
    setTicked(next);
  };

  let body;
  if (scanning) {
    body = (
      <div className="sites-scan__state" role="status">
        <Spinner label="Looking for sites" />
        <span>
          Looking for sites in <strong>{folderName}</strong>, two levels down…
        </span>
        <Button size="sm" variant="secondary" onClick={stop}>
          Stop looking
        </Button>
      </div>
    );
  } else if (error && !result) {
    body = <ErrorState compact title="Couldn’t look in that folder" error={error} actions={<Button size="sm" variant="secondary" onClick={onChooseAnother}>Choose another folder</Button>} />;
  } else if (result && result.sites.length === 0) {
    body = (
      <div className="sites-scan__state">
        <p className="sites-scan__lead">{result.cancelled ? "Stopped before any sites were found." : `No sites in “${folderName}”.`}</p>
        <p className="g-hint">
          A site is a folder with its framework’s settings file (astro.config, eleventy.config, hugo.toml…) or a package.json that names one. Folders inside sites, hidden folders and node_modules aren’t looked in.
        </p>
      </div>
    );
  } else if (result) {
    body = (
      <>
        <div className="sites-scan__head">
          <Checkbox
            checked={allTicked}
            disabled={fresh.length === 0}
            onChange={(on) => setTicked(on ? new Set(fresh.map((site) => site.path)) : new Set())}
            label={fresh.length ? `${counted(fresh.length, "new site")} found` : "Every site here is already in your list"}
          />
          {known > 0 ? <span className="g-hint">{counted(known, "site")} already in your list</span> : null}
        </div>
        <ul className="sites-scan__list" aria-label="Sites found">
          {result.sites.map((site) => (
            <li key={site.path} className="sites-scan__row">
              <Checkbox
                checked={!site.known && ticked.has(site.path)}
                disabled={site.known}
                onChange={(on) => toggle(site.path, on)}
                label={<span className="sites-scan__name">{site.name}</span>}
                description={<span className="g-mono sites-scan__path">{site.path}</span>}
              />
              <span className="sites-scan__meta">
                <Tag variant="mono">{site.framework.version ? `${site.framework.name} ${site.framework.version}` : site.framework.name}</Tag>
                {site.known ? <Badge tone="neutral">In your list</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
        {result.truncated ? <p className="g-hint">The search stopped at its limit, so there may be more sites further in. Choose a folder closer to them to see the rest.</p> : null}
        {result.cancelled ? <p className="g-hint">The search was stopped, so this list may be incomplete.</p> : null}
        {result.skippedLinks > 0 ? <p className="g-hint">{counted(result.skippedLinks, "link to a folder", "links to folders")} weren’t followed.</p> : null}
        {groups.length > 0 ? (
          <label className="sites-scan__group">
            <span className="g-label">File them under</span>
            <Select value={group} onChange={setGroup} options={[{ value: "", label: "No group" }, ...groups.map((entry) => ({ value: entry.id, label: entry.name }))]} />
          </label>
        ) : null}
        {error ? <ErrorState compact title="Couldn’t add the sites" error={error} /> : null}
      </>
    );
  }

  return (
    <Dialog
      open={path !== null}
      onClose={() => {
        stop();
        onClose();
      }}
      title="Add sites from a folder"
      description={path ? <span className="g-mono sites-scan__where">{path}</span> : undefined}
      size="lg"
      dismissible={!adding}
      footer={
        <>
          <Button variant="quiet" onClick={onChooseAnother} disabled={adding || scanning}>
            Look somewhere else
          </Button>
          <span className="g-toolbar__spacer" />
          <Button variant="secondary" onClick={() => (stop(), onClose())} disabled={adding}>
            Not now
          </Button>
          <Button variant="primary" disabled={ticked.size === 0 || scanning} busy={adding} busyLabel="Adding…" onClick={() => void add()}>
            {ticked.size > 0 ? `Add ${counted(ticked.size, "site")}` : "Add sites"}
          </Button>
        </>
      }
    >
      <div className="sites-scan">{body}</div>
      <p className="g-hint sites-scan__note">Adding a site only puts it in this list. Nothing in its folder changes, and it opens the first time you choose it.</p>
    </Dialog>
  );
}

export function addedMessage(result: AddSitesResult): { title: string; body: string } {
  const title = result.added.length ? `Added ${counted(result.added.length, "site")}` : "No sites were added";
  const body = result.skipped.length
    ? `${counted(result.skipped.length, "folder")} skipped: ${result.skipped
        .slice(0, 2)
        .map((entry) => `${lastSegment(entry.path)} — ${entry.reason}`)
        .join(" ")}`
    : "Each one opens the first time you choose it. Nothing in their folders changed.";
  return { title, body };
}

