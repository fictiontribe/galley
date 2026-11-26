import { useState } from "react";
import { Link } from "react-router-dom";
import type { PluginConflict, PluginInfo } from "@galley/core/types";
import { errorShape } from "@/lib/api";
import { useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, Dialog, Icon, ProofMark, Toggle, type IconName } from "@/ui";
import { PluginSettings } from "./PluginSettings";
import { setPluginEnabled } from "./usePlugins";
import { addsAnything, conflictSentence, conflictsOf, contributionLines, missingSettings, plainProblem, sourceWords } from "./words";

export function pluginIcon(plugin: Pick<PluginInfo, "name" | "contributes">): IconName {
  const c = plugin.contributes;
  if (c.imageProviders.length || c.videoProviders.length) return "image";
  if (c.dataSources?.length) return "data";
  if (c.formProviders.length) return "form";
  if (c.scriptIntegrations.length) return "scripts";
  if (c.importers.length) return "upload";
  if (c.tools.length) return "chat";
  if (c.deployTargets.length) return "globe";
  if (c.hooks.length) return "proof";
  return "plugin";
}

export interface PluginDrawerProps {
  plugin: PluginInfo | null;
  conflicts: readonly PluginConflict[];
  nameOf: (name: string) => string;
  linkSiteId: string | null;
  siteId?: string;
  onClose: () => void;
}

/** Focused configuration & details dialog so plugin cards stay calm and uncluttered. */
export function PluginDrawer({ plugin, conflicts, nameOf, linkSiteId, siteId, onClose }: PluginDrawerProps) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!plugin) return null;

  const lines = contributionLines(plugin.contributes, linkSiteId);
  const { lost, won } = conflictsOf(plugin.name, conflicts);
  const missing = missingSettings(plugin);
  const problemItems = plugin.problems.map((problem) => plainProblem(problem, plugin));
  const technical = [
    `Package: ${plugin.name}`,
    plugin.version ? `Version: ${plugin.version}` : null,
    plugin.location ? `From: ${plugin.location}` : null,
    ...plugin.warnings.map((warning) => `Note: ${warning}`),
    ...(plugin.log.length ? ["Recent log:", ...plugin.log.map((line) => `  ${line}`)] : []),
  ].filter((line): line is string => line !== null);
  const problemDetail = [...problemItems.map((item) => item.detail).filter(Boolean), ...technical].join("\n");

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const info = await setPluginEnabled(plugin, enabled, siteId);
      notify({
        tone: "neutral",
        title: enabled ? `${info.displayName} is on` : `${info.displayName} is off`,
        body: enabled ? (info.active ? "What it adds is in use now." : "It’s on, but not working yet — see the note below.") : "What it adds is gone from the app until you turn it on again.",
      });
    } catch (caught) {
      notify({ tone: "danger", title: `Couldn’t turn ${plugin.displayName} ${enabled ? "on" : "off"}`, body: errorShape(caught).message, detail: errorShape(caught).detail });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="plg-drawer__title">
          <span className="plg-icon plg-icon--lg" aria-hidden="true">
            <Icon name={pluginIcon(plugin)} size={20} />
          </span>
          <span>{plugin.displayName}</span>
        </span>
      }
      description={plugin.description}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="plg-drawer">
        <div className="plg-drawer__bar">
          <div className="plg-drawer__meta">
            <span>{sourceWords(plugin.source, hosted)}</span>
            {plugin.version ? <span className="g-mono">v{plugin.version}</span> : null}
            {plugin.displayName !== plugin.name ? <span className="g-mono plg-card__package">{plugin.name}</span> : null}
          </div>
          <div className="plg-drawer__state">
            {plugin.problems.length > 0 && !plugin.active ? <Badge tone="danger">Not working</Badge> : null}
            {plugin.enabled && missing.length > 0 ? <Badge tone="warning">Needs setup</Badge> : null}
            {plugin.canDisable ? (
              <Toggle checked={plugin.enabled} disabled={busy} onChange={(checked) => void toggle(checked)} aria-label={`Use ${plugin.displayName}`} />
            ) : (
              <span className="plg-card__always g-faint">Always on</span>
            )}
          </div>
        </div>

        {problemItems.length > 0 ? (
          <div className="plg-problem" role="status">
            <ProofMark kind="bang" className="plg-problem__mark" />
            <div className="plg-problem__main">
              {problemItems.map((item, index) => (
                <p key={index} className="plg-problem__text">
                  {item.plain}
                </p>
              ))}
              {problemDetail ? (
                <details className="app-details">
                  <summary>Technical details</summary>
                  <pre className="app-error__detail">{problemDetail}</pre>
                  <Button size="sm" variant="quiet" icon="copy" onClick={() => void navigator.clipboard?.writeText(problemDetail).then(() => setCopied(true))}>
                    {copied ? "Copied" : "Copy details"}
                  </Button>
                </details>
              ) : null}
            </div>
          </div>
        ) : null}

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

        {plugin.settings.length > 0 ? (
          <section className="plg-drawer__section" aria-label="Settings">
            <h3 className="g-eyebrow">Settings</h3>
            <PluginSettings plugin={plugin} siteId={siteId} />
          </section>
        ) : null}

        {lines.length > 0 ? (
          <section className="plg-drawer__section" aria-label="Capabilities">
            <h3 className="g-eyebrow">{plugin.active ? "Adds to Galley" : "Would add"}</h3>
            <ul className="plg-adds__list">
              {lines.map((line) => (
                <li key={line.kind} className="plg-adds__item">
                  {line.to && plugin.active ? (
                    <Link className="plg-adds__link" to={line.to} onClick={onClose} title={line.where ? `Shows up in ${line.where}` : undefined}>
                      {line.text}
                      <span className="g-sr">, shows up in {line.where}</span>
                    </Link>
                  ) : (
                    <span>{line.text}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : !addsAnything(plugin.contributes) && plugin.problems.length === 0 ? (
          <p className="g-hint">This plugin doesn’t declare any contributions yet.</p>
        ) : null}

        {problemItems.length === 0 && technical.length > 0 ? (
          <details className="app-details plg-card__tech">
            <summary>Technical details</summary>
            <pre className="app-error__detail">{technical.join("\n")}</pre>
          </details>
        ) : null}
      </div>
    </Dialog>
  );
}
