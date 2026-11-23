/**
 * galley-plugin-example — a small but real plugin, built only on
 * @galley/plugin-kit. It adds three things:
 *
 *   - a script integration (Fathom Analytics), with its snippet as a template
 *   - an afterPublish hook that posts a plain summary of each publish to a
 *     webhook from the plugin's settings
 *   - a read-only assistant tool, count_words, that counts the words on a page
 *
 * Copy this folder to start a plugin of your own; the README says what to change.
 *
 * It imports types only, so the built plugin (dist/index.js) has no
 * dependencies at all and installs anywhere: `satisfies GalleyPlugin` checks
 * the shape as `definePlugin` would, without a run-time import.
 */
import type { GalleyPlugin, PublishResult, SitePluginContext, SiteToolContribution, ScriptIntegrationContribution } from "@galley/plugin-kit";

// #region script
const fathom: ScriptIntegrationContribution = {
  kind: "fathom",
  name: "Fathom Analytics",
  description: "Privacy-first page analytics without cookies.",
  category: "analytics",
  defaultConsent: "necessary",
  defaultPlacement: "head",
  settings: [{ key: "siteId", label: "Site ID", placeholder: "ABCDEFGH", pattern: "^[A-Z0-9]{4,12}$", required: true }],
  docsUrl: "https://usefathom.com/docs/script/embed",
  // {{siteId}} is replaced by the setting's value when the app adds the script to a site.
  snippet: { src: "https://cdn.usefathom.com/script.js", attributes: { "data-site": "{{siteId}}", defer: "" } },
};
// #endregion script

// #region tool
/** Words in a piece of text: runs of letters or digits, apostrophes and hyphens inside words included. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

const countWordsTool: SiteToolContribution = {
  name: "count_words",
  title: "Count the words on a page",
  description:
    "Count the words in one entry: its body and every text field. Use it when the person asks how long a page or post is, or whether it fits a word limit. Read-only.",
  input: {
    type: "object",
    properties: { path: { type: "string", description: "The entry's path, as list_entries or search_content gave it." } },
    required: ["path"],
  },
  mode: "content",
  effect: { readOnly: true },
  label: () => "Counting the words",
  async run(input, ctx) {
    const entry = await ctx.site.readEntry(String(input.path));
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };

    collect(entry.data);
    const body = countWords(entry.body ?? "");
    const fields = countWords(strings.join(" "));

    return { title: entry.title, words: body + fields, body, fields };
  },
};
// #endregion tool

// #region hook
/** One plain sentence about a publish, for a chat channel. */
export function publishSummary(siteName: string, result: PublishResult): string {
  const files = result.files.length;
  const what = `${files} ${files === 1 ? "file" : "files"}`;

  if (result.pullRequestUrl) return `${siteName}: ${what} sent for review — ${result.pullRequestUrl}`;
  return `${siteName}: ${what} published${result.pushed ? "" : " (saved on this computer; not sent to the live site yet)"}.`;
}

async function afterPublish(ctx: SitePluginContext, result: PublishResult): Promise<void> {
  const url = ctx.settings.webhookUrl;

  if (!url) return;
  const site = await ctx.site.summary();
  const response = await ctx.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: publishSummary(site.name, result) }),
  });

  // Throwing is fine: the engine reports it on the Plugins screen and the publish stands.
  if (!response.ok) throw new Error(`the webhook answered ${response.status}`);
  ctx.log.info(`told the webhook about the publish of ${site.name}`);
}
// #endregion hook

// #region plugin
export const examplePlugin = {
  name: "galley-plugin-example",
  displayName: "Example plugin",
  description: "Fathom Analytics, a publish webhook, and a word count for the assistant.",
  version: "0.1.0",
  apiVersion: 1,
  settings: [
    {
      key: "webhookUrl",
      label: "Publish webhook",
      help: "An address that accepts a POST with { text } — a chat channel's incoming webhook. Every publish is summed up there. It can contain a token, so it is kept as a secret.",
      secret: true,
      pattern: "^https://.+",
      placeholder: "https://hooks.example.com/…",
    },
  ],
  scriptIntegrations: [fathom],
  tools: [countWordsTool],
  hooks: { afterPublish },
} satisfies GalleyPlugin;

export default examplePlugin;
// #endregion plugin
