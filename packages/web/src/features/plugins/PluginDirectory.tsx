import { useMemo, useState } from "react";
import type { PluginInfo } from "@galley/core/types";
import { Badge, Button, EmptyState, Icon, Input, cx } from "@/ui";
import { COMMUNITY_SUBMIT_URL, DIRECTORY_CATEGORIES, DIRECTORY_PLUGINS, type DirectoryCategory, type DirectoryPlugin } from "./directory";

export interface PluginDirectoryProps {
  installed: readonly PluginInfo[];
  onConfigureInstalled: (plugin: PluginInfo) => void;
  onInstallPackage: (packageName: string) => void;
  onCreateWithAi: (initialIdea?: string) => void;
}

function kindBadge(kind: DirectoryPlugin["kind"]) {
  if (kind === "official") return <Badge tone="neutral" mark={null}>Official</Badge>;
  if (kind === "blueprint") return <Badge tone="accent" mark={null}>AI Blueprint</Badge>;
  return <Badge tone="neutral" mark={null}>Community</Badge>;
}

/**
 * Modern Web 4.0 plugin directory: curated official packages, community plugins,
 * and instant AI-buildable blueprints — searchable, filterable, and offline-safe.
 */
export function PluginDirectory({ installed, onConfigureInstalled, onInstallPackage, onCreateWithAi }: PluginDirectoryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DirectoryCategory>("all");

  const installedByName = useMemo(() => new Map(installed.map((p) => [p.name, p])), [installed]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return DIRECTORY_PLUGINS.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (!needle) return true;
      const hay = `${entry.name} ${entry.tagline} ${entry.description} ${entry.capabilities.join(" ")} ${entry.author}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [query, category]);

  return (
    <div className="plg-dir">
      <section className="plg-ai-banner" aria-label="Build a plugin with AI">
        <div className="plg-ai-banner__copy">
          <span className="plg-ai-banner__kicker">
            <Icon name="chat" size={14} /> AI Plugin Studio
          </span>
          <h2 className="plg-ai-banner__title">Need something custom? Build a plugin in plain words.</h2>
          <p className="plg-ai-banner__text">
            Every Galley plugin is a single JavaScript file. Describe an assistant tool, form destination, analytics script, or publish check and generate it directly into your site.
          </p>
        </div>
        <div className="plg-ai-banner__actions">
          <Button variant="primary" icon="chat" onClick={() => onCreateWithAi()}>
            Create with AI
          </Button>
        </div>
      </section>

      <div className="plg-toolbar">
        <div className="plg-search">
          <Icon name="search" size={16} className="plg-search__icon" />
          <Input
            type="search"
            value={query}
            placeholder="Search plugins & AI blueprints…"
            aria-label="Search plugins and blueprints"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="plg-pills" role="group" aria-label="Filter by category">
          {DIRECTORY_CATEGORIES.map((cat) => (
            <button key={cat.id} type="button" className={cx("plg-pill", category === cat.id && "plg-pill--active")} aria-pressed={category === cat.id} onClick={() => setCategory(cat.id)}>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No matching plugins yet."
          body={`Nothing in the directory matches “${query.trim()}”. You can generate a bespoke plugin for it in seconds with AI.`}
          actions={
            <Button variant="primary" icon="chat" onClick={() => onCreateWithAi(query.trim())}>
              Build “{query.trim() || "custom plugin"}” with AI
            </Button>
          }
        />
      ) : (
        <div className="plg-grid">
          {filtered.map((entry) => {
            const match = entry.packageName ? installedByName.get(entry.packageName) : undefined;
            return (
              <article key={entry.id} className={cx("plg-card plg-dir-card", entry.kind === "blueprint" && "plg-dir-card--blueprint")}>
                <header className="plg-card__head">
                  <span className="plg-icon" aria-hidden="true">
                    <Icon name={entry.icon} size={18} />
                  </span>
                  <div className="plg-card__titles">
                    <div className="plg-card__title-row">
                      <h3 className="plg-card__name">{entry.name}</h3>
                    </div>
                    <p className="plg-card__meta">
                      <span>{entry.author}</span>
                      {entry.packageName ? <span className="g-mono plg-card__package">{entry.packageName}</span> : null}
                    </p>
                  </div>
                  {match ? <Badge tone="success">Installed</Badge> : kindBadge(entry.kind)}
                </header>

                <p className="plg-card__description">{entry.description}</p>

                <ul className="plg-chips" aria-label="Capabilities">
                  {entry.capabilities.map((cap) => (
                    <li key={cap} className="plg-chip-tag">
                      {cap}
                    </li>
                  ))}
                </ul>

                <footer className="plg-card__foot">
                  {entry.sourceUrl ? (
                    <a className="plg-dir-card__source" href={entry.sourceUrl} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  ) : (
                    <span className="g-faint plg-card__setting-summary">Single-file .mjs recipe</span>
                  )}
                  {match ? (
                    <Button size="sm" variant="secondary" icon="settings" onClick={() => onConfigureInstalled(match)}>
                      {match.settings.length > 0 ? "Configure" : "Details"}
                    </Button>
                  ) : entry.kind === "blueprint" ? (
                    <Button size="sm" variant="secondary" icon="chat" onClick={() => onCreateWithAi(entry.aiIdea ?? entry.tagline)}>
                      Generate with AI
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" icon="download" onClick={() => onInstallPackage(entry.packageName ?? entry.id)}>
                      Install
                    </Button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <footer className="plg-dir__foot">
        <p className="g-hint">
          Built a plugin for Galley?{" "}
          <a className="plg-adds__link" href={COMMUNITY_SUBMIT_URL} target="_blank" rel="noreferrer">
            Submit it to the community directory
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
