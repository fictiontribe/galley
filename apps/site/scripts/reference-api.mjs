// The HTTP API reference (src/content/docs/reference/api.md), rendered from
// the route map itself: every key of `ApiRoutes` in packages/core/src/api.ts
// becomes a row, with its section, what it takes and what it returns read
// from the type, and who may call it read from the server's PUBLIC_ROUTES.
// The one-line description is the line below when there is one, else the
// first sentence of the route's own doc comment; a route with neither stops
// sync-docs and check-docs, so a new route can't go undocumented.
//
//   pnpm --filter @galley/site sync-docs     regenerate the page

import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** One line per route, where the doc comment in api.ts is missing or too long for a table. */
const LINES = {
  "GET /api/meta": "Version, brand, mode (`local` or `hosted`), whether the caller is signed in, whether the desktop app is the host. Answers without a session, with less detail.",
  "POST /api/auth/login": "Hosted mode: sign in with the shared password; sets the session cookie. Rate-limited.",
  "POST /api/auth/logout": "Clear and revoke the session.",
  "GET /api/events": "The live event stream ([below](#events)).",
  "GET /api/settings": "Model and effort, image and video choices, author, theme, previews, and each key's status (never its value).",
  "PATCH /api/settings": "Change any of those.",
  "PUT /api/secrets/:name": "Save a shared key — `anthropic`, `openai`, `google`, `cloudflare` or `vercel`; `null` removes it. Returns its status only.",
  "GET /api/usage": "What the assistant and image generation cost at list prices: today, 7 and 30 days, all time, per model.",
  "GET /api/sites": "The sites in this app's list, with their group, note and what each is waiting on.",
  "POST /api/sites/open": "Add and open a folder (an absolute path). In hosted mode, only inside the sites folder.",
  "POST /api/sites/clone": "Clone a repository into the sites folder, as a job.",
  "POST /api/sites/create": "Create a site from a starter, as a job.",
  "GET /api/starters": "The starters and their looks.",
  "GET /api/jobs/:jobId": "A job's state, progress and result.",
  "GET /api/fs/list": "Folders on the server's disk, for the folder picker; marks the ones that look like sites. Confined to the sites folder in hosted mode.",
  "GET /api/sites/:siteId": "The site, with its full model (detection merged with the config file).",
  "DELETE /api/sites/:siteId": "Forget the site, its own keys and author. Its files stay on disk.",
  "POST /api/sites/:siteId/refresh": "Run detection again.",
  "GET /api/sites/:siteId/config": "The site's `galley.config.json` (or `null`) and the model detection found before it.",
  "PUT /api/sites/:siteId/config": "Replace `galley.config.json`. Validated; refused when invalid.",
  "GET /api/sites/:siteId/entries": "One collection's entries: `collection` plus `search`, `status`, `sort`, `order`, `offset`, `limit`.",
  "GET /api/sites/:siteId/entry": "One entry: parsed data, body, raw text, `hash`, fields and validation issues.",
  "PATCH /api/sites/:siteId/entry": "Edit an entry with [surgical operations](/docs/concepts/surgical-edits/#the-operations); `baseHash` refuses a stale edit.",
  "POST /api/sites/:siteId/entries": "Create an entry (optionally from a template).",
  "DELETE /api/sites/:siteId/entry": "Delete an entry.",
  "GET /api/sites/:siteId/search": "Search every editable string.",
  "POST /api/sites/:siteId/resolve": "Click to edit: which field holds this text on this page — `unique`, `ambiguous` or `none` ([Never guess](/docs/concepts/never-guess/)).",
  "GET /api/sites/:siteId/route": "The entry behind a page address.",
  "POST /api/sites/:siteId/validate": "Validate these files, or everything pending.",
  "GET /api/sites/:siteId/files": "Files matching a glob (ignored folders left out).",
  "GET /api/sites/:siteId/file": "One file's text and `hash`.",
  "PUT /api/sites/:siteId/file": "Write one file; `mode` defaults to `content` ([Modes](/docs/concepts/modes/)).",
  "GET /api/sites/:siteId/media": "The media library.",
  "POST /api/sites/:siteId/media": "Upload a file as a `data:` URL, 25 MB at most.",
  "DELETE /api/sites/:siteId/media": "Delete a media file.",
  "GET /api/sites/:siteId/raw": "A file's bytes from the working tree, or from the last version with `rev=base`, for thumbnails and before/after pictures.",
  "GET /api/images/providers": "The image generators and whether each is ready.",
  "POST /api/sites/:siteId/images/generate": "Make candidate images from a description.",
  "GET /api/images/candidates/:candidateId": "A candidate image's bytes.",
  "POST /api/sites/:siteId/images/save": "Save a candidate into the site's media.",
  "DELETE /api/images/candidates/:candidateId": "Throw a candidate image away.",
  "GET /api/videos/providers": "The video generators, their models, prices and whether each is ready.",
  "GET /api/videos/jobs/:jobId": "A video generation's state and its candidates.",
  "POST /api/sites/:siteId/videos/save": "Save a candidate video into the site's media.",
  "DELETE /api/videos/candidates/:candidateId": "Throw a candidate video away.",
  "GET /api/sites/:siteId/changes": "Everything pending, per file, with field-level changes ([example](/docs/concepts/working-tree/#what-a-change-looks-like)).",
  "GET /api/sites/:siteId/diff": "One file's before and after, with hunks.",
  "POST /api/sites/:siteId/discard": "Discard these files' changes, or everything pending.",
  "POST /api/sites/:siteId/publish": "Publish: commit (and push), or a branch and pull request ([Publishing](/docs/configuration/publishing/)).",
  "POST /api/sites/:siteId/publish/message": "Suggest a one-line note for Version history. Uses the assistant (one request) when a key is set.",
  "GET /api/sites/:siteId/history": "Published versions, newest first.",
  "POST /api/sites/:siteId/revert": "Undo a publish with a new version that reverses it.",
  "GET /api/sites/:siteId/git": "Branch, remote, ahead and behind.",
  "POST /api/sites/:siteId/pull": "Bring the site up to date (`git pull --ff-only`).",
  "GET /api/sites/:siteId/preview": "The preview's state, addresses and log.",
  "POST /api/sites/:siteId/preview/start": "Start the preview ([The preview](/docs/astro/preview/)).",
  "POST /api/sites/:siteId/preview/stop": "Stop it.",
  "POST /api/sites/:siteId/preview/restart": "Restart it.",
  "POST /api/sites/:siteId/build": "Run the site's build and return the end of its output.",
  "GET /api/sites/:siteId/threads": "The site's assistant conversations.",
  "POST /api/sites/:siteId/threads": "Start a conversation.",
  "GET /api/sites/:siteId/threads/:threadId": "One conversation, with its messages.",
  "PATCH /api/sites/:siteId/threads/:threadId": "Rename a conversation.",
  "DELETE /api/sites/:siteId/threads/:threadId": "Delete a conversation.",
  "POST /api/sites/:siteId/threads/:threadId/messages": "Send a message (text, pictures, mode, page context). The reply streams over `/api/events`.",
  "POST /api/sites/:siteId/threads/:threadId/cancel": "Stop the reply in progress.",
  "POST /api/sites/:siteId/threads/:threadId/undo": "Undo one assistant turn: the files it changed are put back.",
  "DELETE /api/groups/:groupId": "Remove a group. Its sites stay in the list, ungrouped.",
  "PUT /api/groups/order": "Put the groups in a new order (every group's id).",
  "GET /api/sites/:siteId/visibility": "Run the Search and AI checks. `render=off` checks the content files only; by default a running preview or an existing build is used, never started.",
  "POST /api/sites/:siteId/redirects/cloudflare/check": "Check Cloudflare's copy matches the list.",
  "POST /api/sites/:siteId/redirects/derived/replace": "Replace a host file that was edited by hand (or was the site's own) with one written from the list.",
  "POST /api/sites/:siteId/visibility/external-links": "Check links to other sites — only when asked: a few at a time, capped.",
  "POST /api/sites/:siteId/brand/ask": "Change the proposal in words; contrast is measured again afterwards.",
  "GET /api/videos/candidates/:candidateId": "A candidate video's bytes.",
  "POST /api/sites/:siteId/videos/generate": "Start making a video; progress arrives as `job` events.",
  "GET /api/sites/:siteId/inbox/:formId/:submissionId": "One submission in full.",
  "GET /api/sites/:siteId/capture": "The site's capture settings: e-mail alerts, forwarding, spam rules, whether a capture key is set.",
  "PATCH /api/sites/:siteId/capture": "Change the capture settings.",
  "POST /api/groups": "Make a group.",
  "PATCH /api/groups/:groupId": "Rename, recolour or fold a group.",
  "GET /api/sites/:siteId/visibility/crawlers": "Each documented AI crawler and whether the site allows it.",
  "GET /api/sites/:siteId/visibility/write/:jobId": "An assistant-written batch's progress.",
  "POST /api/sites/:siteId/visibility/write/:jobId/cancel": "Stop the batch; what is written stays in Proof.",
  "GET /api/sites/:siteId/import/runs/:runId": "An import's progress.",
  "GET /api/sites/:siteId/import/rebuild-all/:jobId": "A Rebuild all run's progress.",
  "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel": "Stop Rebuild all after the page in hand.",
  "POST /api/sites/:siteId/brand/cancel": "Stop reading the brand.",
  "PATCH /api/sites/:siteId/brand/sources/:sourceId": "Change a piece of material's note, or leave it out of the reading.",
  "DELETE /api/sites/:siteId/brand/sources/:sourceId": "Remove a piece of material.",
  "DELETE /api/sites/:siteId/brand/proposal": "Throw the proposal away.",
  "POST /api/sites/:siteId/brand/apply": "Write the brand's values into the site's tokens file, as pending changes.",
};

/** Section headings in api.ts that read better with a different title here. */
const SECTION_TITLES = {
  "meta & auth": "Meta and sign-in",
  "proof & publish": "Proof and publish",
  "preview & build": "Preview and build",
  "search & AI visibility": "Search and AI checks",
  "bringing a site over: the WordPress import (docs/wordpress-import.md)": "The WordPress import",
  "the site's brand (docs/brand.md)": "The site's brand",
  "files (source view)": "Files (the source view)",
};

const INTRO = `This page is for developers integrating with Galley — scripts, CI jobs, other tools. The web app uses exactly this API and nothing else: its client is typed from the \`ApiRoutes\` map in [\`packages/core/src/api.ts\`]({repository}/blob/main/packages/core/src/api.ts), where every request and response type named below is defined. **This page is generated from that file** (\`apps/site/scripts/reference-api.mjs\`), so it lists every route there is. The API is pre-release and may change before 1.0.

## Conventions

- **JSON in, JSON out.** File and entry paths travel in the query string or the body, never as an address segment, relative to the site's folder with \`/\` separators: \`?path=src/content/journal/why-we-make-forty.md\`.
- **Who may call.** Three routes answer anyone: \`GET /api/meta\`, sign-in and sign-out (*Anyone* below). Every other route needs a session (*Signed in*): the browser's session cookie, or \`Authorization: Bearer <token>\`. On your own computer the token is the one in the link Galley prints (set your own with \`GALLEY_TOKEN\`, 16 characters or more); in hosted mode set \`GALLEY_TOKEN\` on the server to allow Bearer access at all. There are no roles: a session can call every route.
- **State-changing requests** (\`POST\`, \`PUT\`, \`PATCH\`, \`DELETE\`) also need the Bearer token, or a same-origin \`Origin\` header. Request bodies are limited to 40 MB.
- **Site routes** (\`/api/sites/:siteId/…\`) run with that site's own keys and author when it has them ([Look after many sites](/docs/editing/many-sites/)).
- **Errors** are \`{ "error": { "code", "message", "detail"? } }\` with a matching status. \`message\` is written for a person; \`detail\` carries the technical cause when it is safe to show.

| \`code\` | Status | Means |
| --- | --- | --- |
| \`invalid\` | 400 | Bad input, named: *“url” isn't right: it must be an https or ssh address.* |
| \`unconfigured\` | 400 | Something needs setting up first — a key, an image provider. A host refusing a key is also \`unconfigured\`, never 401. |
| \`unauthorized\` | 401 | No session, or a Bearer token that isn't valid. |
| \`forbidden\` | 403 | Not writable in this mode, outside the site, or a failed Host or Origin check. |
| \`not-found\` | 404 | No such site, entry, file, job, conversation or route. |
| \`conflict\` | 409 | The file changed since it was read (\`baseHash\`), or a name is taken. |
| \`busy\` | 409 (429 for sign-in) | Something is already running — a reply, a publish, too many sign-in attempts. |
| \`git\`, \`preview\`, \`internal\` | 500 | A git command, the preview, or something unexpected failed. |
| \`ai\` | 502 | The model or image provider failed. |

\`\`\`sh
curl -s -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/sites
\`\`\`

In the tables, *Takes* is the query (\`?…\`) and body; *Returns* is the response type, both named as in \`api.ts\`. A response of *a file* or *a stream* isn't JSON.

Two addresses outside \`/api\` have their own rules: \`/mcp\` (the [MCP endpoint](/docs/integrations/mcp/), Bearer only) and \`/f/:siteId\` (form submissions from the site's own pages — [Forms for developers](/docs/forms/)).`;

const OUTRO = `## Events

\`GET /api/events\` is a Server-Sent Events stream: a \`hello\` event first, then every event as \`data: <json>\`, and a \`: heartbeat\` comment every 20 seconds. Event \`type\`s: ${"{EVENTS}"}. Their shapes are \`ServerEvent\` in [\`packages/core/src/types.ts\`]({repository}/blob/main/packages/core/src/types.ts). \`changes.updated\` carries its origin: \`user\`, \`agent\`, \`external\`, \`publish\`, \`discard\` or \`undo\`.

\`\`\`sh
curl -sN -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/events
\`\`\`

## Next

- [Security](/docs/running/security/) — what a session can do, and what hosted mode adds.
- [Environment variables](/docs/reference/environment/) — \`GALLEY_TOKEN\` and the rest.`;

const cell = (text) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function firstSentence(text) {
  const clean = text.replace(/\s+/g, " ").replace(/ ?Not called through the JSON client\.?/g, "").trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(clean);
  return (match ? match[1] : clean).replace(/^`(GET|POST|PUT|PATCH|DELETE) [^`]+`:?\s*/, "");
}

function typeText(node, sourceFile) {
  if (!node) return "";
  if (ts.isImportTypeNode(node)) return node.qualifier ? node.qualifier.getText(sourceFile) : node.getText(sourceFile);
  if (ts.isTypeLiteralNode(node)) {
    const keys = node.members.filter((m) => m.name).map((m) => `${m.name.getText(sourceFile).replace(/^"|"$/g, "")}${m.questionToken ? "?" : ""}`);
    return keys.length ? `{ ${keys.join(", ")} }` : "{ }";
  }
  if (ts.isIntersectionTypeNode(node)) return node.types.map((t) => typeText(t, sourceFile)).join(" & ");
  if (ts.isUnionTypeNode(node)) return node.types.map((t) => typeText(t, sourceFile)).join(" or ");
  if (ts.isArrayTypeNode(node)) return `${typeText(node.elementType, sourceFile)}[]`;
  if (ts.isMappedTypeNode(node)) {
    const m = /keyof (\w+)/.exec(node.getText(sourceFile));
    return m ? `${m[1]} options` : "{ … }";
  }
  if (ts.isTypeReferenceNode(node) && node.typeName.getText(sourceFile) === "Partial" && node.typeArguments?.length === 1) return `Partial<${typeText(node.typeArguments[0], sourceFile)}>`;
  return node.getText(sourceFile).replace(/import\("[^"]+"\)\./g, "");
}

function member(lit, name) {
  return lit.members.find((m) => m.name && m.name.getText().replace(/^"|"$/g, "") === name);
}

/** The ApiRoutes map, in file order, with sections. */
export function readRoutes(repoRoot) {
  const path = join(repoRoot, "packages/core/src/api.ts");
  const text = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const iface = sourceFile.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === "ApiRoutes");

  if (!iface) throw new Error("ApiRoutes was not found in packages/core/src/api.ts.");
  const appText = readFileSync(join(repoRoot, "packages/server/src/app.ts"), "utf8");
  const publicMatch = /PUBLIC_ROUTES = new Set\(\[([^\]]*)\]\)/.exec(appText);
  const publicRoutes = new Set(publicMatch ? [...publicMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []);
  const routes = [];
  let section = "Other";

  for (const m of iface.members) {
    const leading = text.slice(m.getFullStart(), m.getStart(sourceFile));
    const heading = /──\s+(.+?)\s+─{3,}/.exec(leading);

    if (heading) section = SECTION_TITLES[heading[1]] ?? heading[1][0].toUpperCase() + heading[1].slice(1);
    const key = m.name.text;
    const doc = ts.getJSDocCommentsAndTags(m).map((d) => (typeof d.comment === "string" ? d.comment : "")).join(" ");
    const lit = m.type;
    const query = lit && ts.isTypeLiteralNode(lit) ? member(lit, "query") : null;
    const body = lit && ts.isTypeLiteralNode(lit) ? member(lit, "body") : null;
    const response = lit && ts.isTypeLiteralNode(lit) ? member(lit, "response") : null;

    routes.push({
      key,
      section,
      line: LINES[key] ?? (doc ? firstSentence(doc) : null),
      query: query ? typeText(query.type, sourceFile) : "",
      body: body ? typeText(body.type, sourceFile) : "",
      response: response ? typeText(response.type, sourceFile) : "",
      stream: /text\/event-stream/.test(doc),
      who: publicRoutes.has(key) ? "Anyone" : "Signed in",
    });
  }
  return routes;
}

function eventTypes(repoRoot) {
  const text = readFileSync(join(repoRoot, "packages/core/src/types.ts"), "utf8");
  const start = text.indexOf("export type ServerEvent");
  const block = text.slice(start, text.indexOf(";\n", start));
  return [...new Set([...block.matchAll(/type: "([a-z.-]+)"/g)].map((m) => m[1]))];
}

/** The page's body (no front matter). Throws when a route has no description. */
export function renderApiReference(repoRoot) {
  const routes = readRoutes(repoRoot);
  const missing = routes.filter((r) => !r.line).map((r) => r.key);

  if (missing.length) throw new Error(`these routes have no description (add a doc comment in api.ts or a line in apps/site/scripts/reference-api.mjs): ${missing.join(", ")}`);
  const stale = Object.keys(LINES).filter((key) => !routes.some((r) => r.key === key));

  if (stale.length) throw new Error(`apps/site/scripts/reference-api.mjs describes routes that are not in ApiRoutes: ${stale.join(", ")}`);
  const sections = [];

  for (const route of routes) {
    let current = sections.at(-1);

    if (!current || current.title !== route.section) sections.push((current = { title: route.section, routes: [] }));
    current.routes.push(route);
  }
  const takes = (r) => [r.query ? `\`?${r.query.replace(/^\{ | \}$/g, "").replace(/, /g, "&")}\`` : "", r.body ? `\`${r.body}\`` : ""].filter(Boolean).join(" ") || "—";
  const returns = (r) => (r.response === "never" ? (r.stream ? "a stream" : "a file") : `\`${r.response}\``);
  const out = [INTRO, ""];

  for (const s of sections) {
    out.push(`## ${s.title}`, "", "| Route | Does | Takes | Returns | Who |", "| --- | --- | --- | --- | --- |");
    for (const r of s.routes) out.push(`| \`${r.key}\` | ${cell(r.line)} | ${cell(takes(r))} | ${cell(returns(r))} | ${r.who} |`);
    out.push("");
  }
  out.push(OUTRO.replace("{EVENTS}", eventTypes(repoRoot).map((t) => `\`${t}\``).join(", ")));
  return `${out.join("\n")}\n`;
}
