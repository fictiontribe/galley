/**
 * POST /api/sites/:siteId/preview/entry — where the editor loads its two
 * frames from.
 *
 * On this computer (local mode) the answer is the proxies' own addresses, as
 * it always was. On a hosted install with a preview gateway each address is
 * the gateway's entry page with a one-use ticket made for this browser's
 * session (gateway-auth.ts). A script's Bearer token has no session, so it
 * can't open a preview: the viewer cookie would outlive nothing.
 */
import type { Context } from "hono";
import { GalleyError } from "@galley/core";
import type { PreviewStatus } from "@galley/core/types";
import { bearerToken, requestSession } from "./auth";
import { gatewayEntryUrl } from "./gateway";
import type { RouteContext } from "./routes";

export const ENTRY_NEEDS_SESSION = "A preview can only be opened from a signed-in browser, not with an access token. Sign in to the editor and open it there.";

export function previewEntry(c: Context, ctx: RouteContext, status: PreviewStatus): { preview: string | null; baseline: string | null } {
  const entry = ctx.options.previewEntry;

  if (ctx.options.mode !== "hosted") return { preview: status.url, baseline: status.baselineUrl };
  // A hosted install without an address for the preview has nothing to let anyone into.
  if (!entry) return { preview: null, baseline: null };
  const session = bearerToken(c) === null ? requestSession(c, ctx.session) : null;

  if (!session) throw new GalleyError("forbidden", ENTRY_NEEDS_SESSION);
  if (!status.url) return { preview: null, baseline: null };
  return {
    preview: gatewayEntryUrl(entry.origins.preview, entry.issue(session)),
    baseline: status.baselineUrl ? gatewayEntryUrl(entry.origins.live, entry.issue(session)) : null,
  };
}
