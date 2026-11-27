/**
 * galley-plugin-example — a small but real plugin, built only on
 * @galleycms/plugin-kit. It adds three things:
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
import type { PublishResult, SitePluginContext, SiteToolContribution, ScriptIntegrationContribution } from "@galleycms/plugin-kit";
/** Words in a piece of text: runs of letters or digits, apostrophes and hyphens inside words included. */
export declare function countWords(text: string): number;
/** One plain sentence about a publish, for a chat channel. */
export declare function publishSummary(siteName: string, result: PublishResult): string;
declare function afterPublish(ctx: SitePluginContext, result: PublishResult): Promise<void>;
export declare const examplePlugin: {
    name: string;
    displayName: string;
    description: string;
    version: string;
    apiVersion: 1;
    settings: {
        key: string;
        label: string;
        help: string;
        secret: true;
        pattern: string;
        placeholder: string;
    }[];
    scriptIntegrations: ScriptIntegrationContribution[];
    tools: SiteToolContribution[];
    hooks: {
        afterPublish: typeof afterPublish;
    };
};
export default examplePlugin;
