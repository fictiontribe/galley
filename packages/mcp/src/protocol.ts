/**
 * The newest MCP revision this server speaks — whatever the installed SDK
 * implements (it negotiates down to older revisions with older clients).
 * The handshake-free 2026-07-28 revision isn't in the SDK yet; dual-era
 * clients fall back to this one on their own.
 */
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

export const PROTOCOL_REVISION: string = LATEST_PROTOCOL_VERSION;
