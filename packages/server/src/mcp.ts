/**
 * The MCP endpoint, `POST/GET/DELETE /mcp` — the engine's tools over
 * Streamable HTTP for any LLM harness, inside the running server so edits
 * reach an open UI live through the event bus.
 *
 * Guards, in order (after the app-wide Host check, the DNS-rebinding guard):
 *   1. Origin. Harness clients send none; a browser always does. Per the MCP
 *      spec, an Origin that is present and not this server's own is refused
 *      with 403 — even with a valid token.
 *   2. Bearer token: the server's session token (GALLEY_TOKEN, or the one
 *      minted at start-up in local mode) or the stable token from
 *      `galley mcp token`. Cookies are never accepted here, so a page in a
 *      browser can't ride on a signed-in session.
 * Sessions, the protocol-version header and DELETE are handled by @galley/mcp.
 */
import type { Context } from "hono";
import { createMcpHttpHandler, createMcpServer, jsonRpcError, mcpTokenVerifier, registrySites, type McpHttpHandler } from "@galley/mcp";
import type { GalleyImageService } from "@galley/core/ai";
import type { AgentMode } from "@galley/core/types";
import { bearerToken, safeEqual } from "./auth";
import type { Services } from "./types";

export interface McpMountOptions {
  mode: AgentMode;
  allowPublish: boolean;
  /** Galley home, where the stable MCP token's hash is kept. */
  home: string;
  productName: string;
  version: string;
  log?: (line: string) => void;
}

export interface McpMount {
  readonly mode: AgentMode;
  readonly allowPublish: boolean;
  readonly handler: McpHttpHandler;
  /** The stable token from `galley mcp token`. */
  verifyToken(token: string): Promise<boolean>;
  close(): Promise<void>;
}

export function createMcpMount(services: Services, options: McpMountOptions): McpMount {
  const handler = createMcpHttpHandler({
    async createServer() {
      // Read per session, so choosing an image provider in Settings shows up on the next connection.
      const settings = await services.settings.get().catch(() => null);
      const images = settings?.images.provider ? (services.images as GalleyImageService) : undefined;

      return createMcpServer({
        sites: registrySites(services.registry),
        mode: options.mode,
        allowPublish: options.allowPublish,
        ...(images ? { images } : {}),
        // The same summary the app's Publish button proposes.
        describeChanges: (siteId, changes) => services.agent.describeChanges(siteId, changes),
        transport: "http",
        brand: { name: options.productName, version: options.version },
      });
    },
    ...(options.log ? { log: options.log } : {}),
  });

  return {
    mode: options.mode,
    allowPublish: options.allowPublish,
    handler,
    verifyToken: mcpTokenVerifier(options.home),
    close: () => handler.close(),
  };
}

export interface McpGuard {
  sessionToken: string | null;
  /** This server's own origins (scheme://host[:port]), lower-case. */
  expectedOrigins(c: Context): string[];
  productSlug: string;
}

export function mcpRoute(mount: McpMount, guard: McpGuard) {
  return async (c: Context): Promise<Response> => {
    const origin = c.req.header("origin");

    if (origin !== undefined && !guard.expectedOrigins(c).includes(origin.toLowerCase())) {
      return jsonRpcError(403, "This request came from a web page on another site, so it was blocked.");
    }
    const bearer = bearerToken(c);
    const valid =
      bearer !== null && ((guard.sessionToken !== null && safeEqual(bearer, guard.sessionToken)) || (await mount.verifyToken(bearer).catch(() => false)));

    if (!valid) {
      return jsonRpcError(
        401,
        bearer === null
          ? `This needs an access token: send Authorization: Bearer <token>. Make one with \`${guard.productSlug} mcp token\`.`
          : "That access token isn't valid.",
        -32001,
        { "www-authenticate": `Bearer realm="${guard.productSlug}"` }
      );
    }
    return mount.handler.handle(c.req.raw);
  };
}
