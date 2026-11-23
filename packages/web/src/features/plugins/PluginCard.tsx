import { useState } from "react";
import { Link } from "react-router-dom";
import type { PluginConflict, PluginInfo } from "@galley/core/types";
import { errorShape } from "@/lib/api";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, ProofMark, Toggle, cx } from "@/ui";
import { PluginSettings } from "./PluginSettings";
import { setPluginEnabled } from "./usePlugins";
import { addsAnything, conflictSentence, conflictsOf, contributionLines, missingSettings, plainProblem, sourceWords } from "./words";

export interface PluginCardProps {
  plugin: PluginInfo;
  conflicts: readonly PluginConflict[];
  /** Name people read, by package name — for conflict sentences. */
  nameOf: (name: string) => string;
  /** The site whose screens the site-wide contributions link to. */
  linkSiteId: string | null;
  /** The site this list is for (sent with changes so its own plugins are found). */
  siteId?: string;
}

/** Only what the switch doesn't already say: that it isn't working, or still needs a setting. */
function Status({ plugin }: { plugin: PluginInfo }) {
  if (plugin.problems.length > 0 && !plugin.active) return <Badge tone="danger">Not working</Badge>;
  if (plugin.enabled && missingSettings(plugin).length > 0) return <Badge tone="warning">Needs a setting</Badge>;
  return null;
}

/** The problem as plain sentences; the engine's own words and the plugin's details behind one disclosure. */
function Problems({ plugin, technical }: { plugin: PluginInfo; technical: string[] }) {
  const [copied, setCopied] = useState(false);
  if (plugin.problems.length === 0) return null;
  const items = plugin.problems.map((problem) => plainProblem(problem, plugin));
  const detail = [...items.map((item) => item.detail).filter(Boolean), ...technical].join("\n");
  return (
    <div className="plg-problem" role="status">
      <ProofMark kind="bang" className="plg-problem__mark" />
      <div className="plg-problem__main">
        {items.map((item, index) => (
          <p key={index} className="plg-problem__text">
            {item.plain}
          </p>
        ))}
        {detail ? (
          <details className="app-details">
            <summary>Technical details</summary>
            <pre className="app-error__detail">{detail}</pre>
            <Button size="sm" variant="quiet" icon="copy" onClick={() => void navigator.clipboard?.writeText(detail).then(() => setCopied(true))}>
              {copied ? "Copied" : "Copy details"}
            </Button>
          </details>
        ) : null}
      </div>
    </div>
  );
}

/** One plugin: who it is, where it came from, its switch, what it adds and where, its problems and settings. */
export function PluginCard({ plugin, conflicts, nameOf, linkSiteId, siteId }: PluginCardProps) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const [busy, setBusy] = useState(false);
  const lines = contributionLines(plugin.contributes, linkSiteId);
  const { lost, won } = conflictsOf(plugin.name, conflicts);
  const missing = missingSettings(plugin);
  const technical = [
    `Package: ${plugin.name}`,
    plugin.location ? `From: ${plugin.location}` : null,
    ...plugin.warnings.map((warning) => `Note: ${warning}`),
    ...(plugin.log.length ? ["Recent log:", ...plugin.log.map((line) => `  ${line}`)] : []),
  ].filter((line): line is string => line !== null);
  // One disclosure per card: with the problem when there is one, else only when there's more to say than the package name.
  const ownDetails = plugin.problems.length === 0 && (plugin.log.length > 0 || plugin.warnings.length > 0);
  const titleId = `plugin-${plugin.name.replace(/[^a-z0-9]+/gi, "-")}`;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const info = await setPluginEnabled(plugin, enabled, siteId);
      notify({
        tone: "neutral",
        title: enabled ? `${info.displayName} is on` : `${info.displayName} is off`,
        body: enabled ? (info.active ? "What it adds is in use now." : "It’s on, but not working yet — see the note on it.") : "What it adds is gone from the app until you turn it on again.",
      });
    } catch (caught) {
      notify({ tone: "danger", title: `Couldn’t turn ${plugin.displayName} ${enabled ? "on" : "off"}`, body: errorShape(caught).message, detail: errorShape(caught).detail });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={cx("plg-card", !plugin.active && "plg-card--inactive", plugin.problems.length > 0 && "plg-card--problem")} aria-labelledby={titleId}>
      <header className="plg-card__head">
        <div className="plg-card__titles">
          <h3 className="plg-card__name" id={titleId}>
            {plugin.displayName}
          </h3>
          <p className="plg-card__meta">
            <span>{sourceWords(plugin.source, hosted)}</span>
            {plugin.version ? <span className="g-mono">{plugin.version}</span> : null}
            {plugin.displayName !== plugin.name ? <span className="g-mono plg-card__package">{plugin.name}</span> : null}
          </p>
        </div>
        <Status plugin={plugin} />
        {plugin.canDisable ? (
          <span className="plg-card__switch">
            <Toggle checked={plugin.enabled} disabled={busy} onChange={(checked) => void toggle(checked)} aria-label={`Use ${plugin.displayName}`} />
          </span>
        ) : (
          <span className="plg-card__always g-faint" title="The app’s own parts can’t be turned off">
            Always on
          </span>
        )}
      </header>

      {plugin.description ? <p className="plg-card__description">{plugin.description}</p> : null}

      <Problems plugin={plugin} technical={technical} />

      {lost.length > 0 || won.length > 0 ? (
        <ul className="plg-notes">
          {lost.map((conflict) => (
            <li key={`${conflict.kind}-${conflict.id}`}>
              <ProofMark kind="transpose" tone="change" /> {conflictSentence(conflict, nameOf)}
            </li>
          ))}
          {won.map((conflict) => (
            <li key={`${conflict.kind}-${conflict.id}`}>
              <ProofMark kind="reg" /> {conflictSentence(conflict, nameOf)}
            </li>
          ))}
        </ul>
      ) : null}

      {plugin.active && missing.length > 0 ? (
        <p className="plg-card__needs">It does nothing until its {missing.map((setting) => setting.label).join(" and ")} {missing.length === 1 ? "is" : "are"} set, below.</p>
      ) : null}

      {lines.length > 0 ? (
        <div className="plg-adds">
          <p className="g-eyebrow">{plugin.active ? "Adds" : "Would add"}</p>
          <ul className="plg-adds__list">
            {lines.map((line) => (
              <li key={line.kind} className="plg-adds__item">
                {line.to && plugin.active ? (
                  <Link className="plg-adds__link" to={line.to} title={line.where ? `Shows up in ${line.where}` : undefined}>
                    {line.text}
                    <span className="g-sr">, shows up in {line.where}</span>
                  </Link>
                ) : (
                  <span>{line.text}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : addsAnything(plugin.contributes) ? null : plugin.problems.length === 0 ? (
        <p className="g-hint plg-card__nothing">It doesn’t add anything yet.</p>
      ) : null}

      <PluginSettings plugin={plugin} siteId={siteId} />

      {ownDetails ? (
        <details className="app-details plg-card__tech">
          <summary>Technical details</summary>
          <pre className="app-error__detail">{technical.join("\n")}</pre>
        </details>
      ) : null}
    </article>
  );
}
