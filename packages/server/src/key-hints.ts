/**
 * The last characters of a stored key ("…a1b2") help the people who look
 * after the keys tell one from another. Nobody else needs them, and on a
 * hosted install several answers that anyone signed in may read list the
 * keys — the app uses them to say what is available (the assistant, image
 * and video services, hosts, plugins). For a signed-in person whose role
 * doesn't include "manage", those answers go out with every hint taken out;
 * whether a key is set, and where it comes from, stay.
 *
 * One entry per route whose answer carries a hint. The other answers that
 * do (a site's connections, the hosts for the editor, saving a key) are
 * "manage" routes, so only the people who may manage ever get them.
 */
import type { ApiRouteKey, RouteResponse } from "@galley/core/api";
import type { PluginInfo } from "@galley/core/types";

type Without = { [K in ApiRouteKey]?: (answer: RouteResponse<K>) => RouteResponse<K> };

function unhinted<T extends { hint?: string }>(item: T): Omit<T, "hint"> {
  const { hint: _hint, ...rest } = item;

  return rest;
}

const plugins = (list: PluginInfo[]): PluginInfo[] => list.map((plugin) => ({ ...plugin, settings: plugin.settings.map(unhinted) }));

const WITHOUT_HINTS: Without = {
  "GET /api/settings": (settings) => ({ ...settings, secrets: settings.secrets.map(unhinted) }),
  "GET /api/deploy/targets": (answer) => ({ ...answer, targets: answer.targets.map((target) => ({ ...target, secrets: target.secrets.map(unhinted) })) }),
  "GET /api/plugins": (answer) => ({ ...answer, plugins: plugins(answer.plugins) }),
  "GET /api/sites/:siteId/plugins": (answer) => ({ ...answer, plugins: plugins(answer.plugins) }),
  // "publish": an editor reads the capture settings (the inbox's), but the capture key and the Turnstile secret are an owner's.
  "GET /api/sites/:siteId/capture": (capture) => ({ ...capture, captureKey: unhinted(capture.captureKey), turnstile: unhinted(capture.turnstile) }),
};

/** The routes whose answer is changed for someone who may not manage. */
export const HINTED_ROUTES = Object.keys(WITHOUT_HINTS) as ApiRouteKey[];

/** A route's answer with every key hint taken out; any other route's answer as it is. */
export function withoutKeyHints(route: ApiRouteKey, answer: unknown): unknown {
  const strip = WITHOUT_HINTS[route] as ((value: unknown) => unknown) | undefined;

  return strip && answer !== null && typeof answer === "object" ? strip(answer) : answer;
}
