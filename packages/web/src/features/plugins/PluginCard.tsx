import { useState } from "react";
import type { PluginConflict, PluginInfo } from "@galley/core/types";
import { errorShape } from "@/lib/api";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, Icon, ProofMark, Toggle, cx } from "@/ui";
import { pluginIcon } from "./PluginDrawer";
import { setPluginEnabled } from "./usePlugins";
import { conflictsOf, contributionLines, missingSettings, plainProblem, sourceWords } from "./words";

export interface PluginCardProps {
  plugin: PluginInfo;
  conflicts: readonly PluginConflict[];
  linkSiteId: string | null;
  siteId?: string;
  /** Opens the focused settings & details drawer for this plugin. */
  onInspect: (plugin: PluginInfo) => void;
}

/** Short origin pill for the card header. */
function originLabel(source: PluginInfo["source"], hosted: boolean): string {
  if (source === "builtin") return "Built-in";
  if (source === "site") return "This site";
  return hosted ? "Server" : "Installed";
}

/**
 * Clean, scannable plugin card: identity, concise description, capability chips,
 * on/off switch, and a single Configure / Details button that opens the drawer.
 * Settings are never dumped inline onto the grid.
 */
export function PluginCard({ plugin, conflicts, linkSiteId, siteId, onInspect }: PluginCardProps) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const [busy, setBusy] = useState(false);

  const lines = contributionLines(plugin.contributes, linkSiteId);
  const { lost } = conflictsOf(plugin.name, conflicts);
  const missing = missingSettings(plugin);
  const hasSettings = plugin.settings.length > 0;
  const hasProblems = plugin.problems.length > 0;
  const needsSetup = plugin.enabled && missing.length > 0;
  const titleId = `plugin-${plugin.name.replace(/[^a-z0-9]+/gi, "-")}`;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const info = await setPluginEnabled(plugin, enabled, siteId);
      notify({
        tone: "neutral",
        title: enabled ? `${info.displayName} is on` : `${info.displayName} is off`,
        body: enabled ? (info.active ? "What it adds is in use now." : "It’s on, but not working yet — open details to see why.") : "What it adds is gone from the app until you turn it on again.",
      });
    } catch (caught) {
      notify({ tone: "danger", title: `Couldn’t turn ${plugin.displayName} ${enabled ? "on" : "off"}`, body: errorShape(caught).message, detail: errorShape(caught).detail });
    } finally {
      setBusy(false);
    }
  };

  const visibleChips = lines.slice(0, 3);
  const extraCount = lines.length - visibleChips.length;
  const firstProblem = hasProblems ? plainProblem(plugin.problems[0]!, plugin).plain : null;

  return (
    <article className={cx("plg-card", !plugin.active && "plg-card--inactive", hasProblems && "plg-card--problem")} aria-labelledby={titleId}>
      <header className="plg-card__head">
        <span className="plg-icon" aria-hidden="true">
          <Icon name={pluginIcon(plugin)} size={18} />
        </span>
        <div className="plg-card__titles">
          <div className="plg-card__title-row">
            <h3 className="plg-card__name" id={titleId}>
              <button type="button" className="plg-card__title-btn" onClick={() => onInspect(plugin)}>
                {plugin.displayName}
              </button>
            </h3>
            {hasProblems && !plugin.active ? <Badge tone="danger">Not working</Badge> : null}
            {!hasProblems && needsSetup ? <Badge tone="warning">Needs setup</Badge> : null}
          </div>
          <p className="plg-card__meta">
            <span>{originLabel(plugin.source, hosted)}</span>
            {plugin.version ? <span className="g-mono">v{plugin.version}</span> : null}
            {lost.length > 0 ? <span className="plg-card__conflict">Overridden</span> : null}
          </p>
        </div>
        {plugin.canDisable ? (
          <span className="plg-card__switch">
            <Toggle checked={plugin.enabled} disabled={busy} onChange={(checked) => void toggle(checked)} aria-label={`Use ${plugin.displayName}`} />
          </span>
        ) : (
          <span className="plg-card__always g-faint" title={`${sourceWords(plugin.source, hosted)} — always on`}>
            Always on
          </span>
        )}
      </header>

      {plugin.description ? <p className="plg-card__description">{plugin.description}</p> : null}

      {firstProblem ? (
        <p className="plg-card__alert plg-card__alert--danger" role="status">
          <ProofMark kind="bang" />
          <span>{firstProblem}</span>
        </p>
      ) : needsSetup ? (
        <p className="plg-card__alert plg-card__alert--warn">
          <span>Needs {missing.map((s) => s.label).join(" and ")}</span>
        </p>
      ) : null}

      {visibleChips.length > 0 ? (
        <ul className="plg-chips" aria-label={plugin.active ? "Capabilities" : "Capabilities when enabled"}>
          {visibleChips.map((line) => (
            <li key={line.kind} className="plg-chip-tag">
              {line.text.split(":")[0]}
            </li>
          ))}
          {extraCount > 0 ? <li className="plg-chip-tag plg-chip-tag--more">+{extraCount} more</li> : null}
        </ul>
      ) : null}

      <footer className="plg-card__foot">
        <span className="plg-card__setting-summary g-faint">
          {hasSettings ? (needsSetup ? "Setup required" : `${plugin.settings.length} ${plugin.settings.length === 1 ? "setting" : "settings"}`) : plugin.name}
        </span>
        <Button size="sm" variant={needsSetup || hasProblems ? "secondary" : "quiet"} icon={hasSettings ? "settings" : undefined} onClick={() => onInspect(plugin)}>
          {hasProblems ? "Inspect" : needsSetup ? "Set up" : hasSettings ? "Configure" : "Details"}
        </Button>
      </footer>
    </article>
  );
}
