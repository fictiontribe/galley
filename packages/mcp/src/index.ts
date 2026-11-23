/**
 * @galley/mcp — the engine's tools over the Model Context Protocol, so any
 * LLM harness can read, edit, proof and publish a site without our UI.
 *
 *   createMcpServer        one implementation, transport-agnostic
 *   serveStdio             `galley mcp [path]`: one site on stdin/stdout
 *   createMcpHttpHandler   Streamable HTTP sessions, mounted by the server at /mcp
 *   ensureMcpToken         the stable Bearer token for harness configs
 *   clientConfig           ready-to-paste configuration per client
 */
export { createMcpServer, type McpServerOptions } from "./server";
export { singleSite, registrySites, type SiteResolver } from "./sites";
export { serveStdio, reserveStdout, type StdioSession } from "./stdio";
export { createMcpHttpHandler, jsonRpcError, SESSION_HEADER, type McpHttpHandler, type McpHttpOptions } from "./http";
export { ensureMcpToken, mcpTokenVerifier, TOKEN_FILE, type TokenInfo } from "./token";
export { clientConfig, shellQuote, MCP_CLIENTS, CLIENT_TITLES, type ClientConfig, type ConfigRequest, type McpClient } from "./config";
export { toolCatalog, type CatalogEntry, type CatalogOptions } from "./catalog";
export { serverInstructions } from "./instructions";
export { toolReference, setupReference, replaceBetween } from "./reference";
export { PROTOCOL_REVISION } from "./protocol";
