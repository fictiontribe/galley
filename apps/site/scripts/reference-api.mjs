// The HTTP API reference (src/content/docs/reference/api.md), rendered from
// the route map itself: every key of `ApiRoutes` in packages/core/src/api.ts
// becomes a row, with its section, what it takes and what it returns read
// from the type, and who may call it read from ROUTE_ACCESS in
// packages/core/src/install/route-access.ts (the table the server enforces).
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
  "GET /api/meta": "Version, brand, mode (`local` or `hosted`), whether the caller is signed in, whether the desktop app is the host; for a signed-in caller with managed AI on (`GALLEY_AI_MANAGED`), `ai` (`AiMetaInfo`: managed, what a credit is worth, whether AI is switched off, the manage address). Answers without a session, with less detail.",
  "POST /api/auth/login": "Hosted install: sign in with an e-mail and password (the password alone for an owner from before accounts, who has no e-mail yet); sets the session cookie. Rate-limited.",
  "POST /api/auth/logout": "Clear and revoke the session.",
  "GET /api/events": "The live event stream ([below](#events)).",
  "GET /api/settings": "Model and effort, image and video choices, author, theme, previews, and each key's status (never its value).",
  "PATCH /api/settings": "Change any of those.",
  "PUT /api/secrets/:name": "Save a shared key — `anthropic`, `openai`, `google`, `cloudflare` or `vercel`; `null` removes it. Returns its status only.",
  "GET /api/usage": "What the assistant and image generation cost at list prices: today, 7 and 30 days, all time, per model.",
  "GET /api/sites": "The sites in this app's list, with their group, note and what each is waiting on.",
  "POST /api/sites/open": "Add and open a folder (an absolute path). A hosted install refuses it (403): it looks after one site.",
  "POST /api/sites/clone": "Clone a repository into the sites folder, as a job. Refused on a hosted install.",
  "POST /api/sites/create": "Create a site from a starter, as a job. Refused on a hosted install.",
  "GET /api/starters": "The starters and their looks.",
  "GET /api/jobs/:jobId": "A job's state, progress and result.",
  "GET /api/fs/list": "Folders on this computer's disk, for the folder picker; marks the ones that look like sites. Refused on a hosted install.",
  "GET /api/sites/:siteId": "The site, with its full model (detection merged with the config file).",
  "DELETE /api/sites/:siteId": "Forget the site, its own keys and author. Its files stay on disk. Refused on a hosted install.",
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
  "GET /api/sites/:siteId/git": "Branch, remote, ahead and behind, as of the last look at the code host (`checkedAt`).",
  "POST /api/sites/:siteId/git/check": "Ask the code host what is new (a fetch), changing no file: the status as of now, or why it couldn't look (`checkProblem`).",
  "POST /api/sites/:siteId/pull": "Bring the site up to date: fetch, then `git merge --ff-only`. A running preview is stopped first and started again on the new files.",
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
  "POST /api/sites/:siteId/threads/:threadId/undo": "Undo one assistant turn: the files it changed are put back, except those changed again since, which are left as they are and listed in `left`.",
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
  "GET /api/setup": "Where first run is: the owner's account, site, details or done, with the site's state and what the operator fixed. Takes the setup code until an owner exists.",
  "PUT /api/setup/details": "Save the publishing name and e-mail and the live address during first run.",
  "POST /api/setup/finish": "End first run once the owner's account exists and the site is connected. The setup link stops working.",
  "GET /api/people": "Everyone with an account (role, switched off or not, when they last signed in), the open invitations, and whether this server e-mails links (it needs outgoing e-mail and its public address both set). With the server's access token, where an identity provider is set up: `OperatorPeople` (ids, roles, switched off, subjects; no names or e-mails).",
  "GET /api/people/by-identity": "The server's access token only, where an identity provider is set up: the account with this subject at the provider (id, role, switched off), or 404.",
  "GET /api/install": "The Install page: address, version, the site's repository and how it is reached, the publishing name, what is stored where.",
  "GET /api/editor-hosts": "The places the editor can be hosted, each key's status (never its value), and the hosts that can't run it with the reason.",
  "GET /api/sites/:siteId/editor": "The site's editor online: what its settings say, what this computer created, whether it answers, its version.",
  "POST /api/sites/:siteId/editor/upgrade": "Move the hosted editor to this version's image, keeping its disk, as a job.",
  "POST /api/sites/:siteId/editor/backup": "Copy the hosted editor's disk on the host, or say where its backups are downloaded.",
  "DELETE /api/sites/:siteId/editor": "Delete exactly what was created for the hosted editor, as a job. `confirm` must be true.",
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
  "the hosted install: first run (install/types.ts)": "The hosted install: first run",
  "the hosted install: the Install page": "The hosted install: the Install page",
  "the hosted install: people (install/accounts.ts)": "The hosted install: people",
  "\"Host the editor online\" (hosting/types.ts)": "Host the editor online",
};

const INTRO = `This page is for developers integrating with Galley — scripts, CI jobs, other tools. The web app uses exactly this API and nothing else: its client is typed from the \`ApiRoutes\` map in [\`packages/core/src/api.ts\`]({repository}/blob/main/packages/core/src/api.ts), where every request and response type named below is defined. **This page is generated from that file** (\`apps/site/scripts/reference-api.mjs\`), so it lists every route there is. The API is at version 0.1 and may change before 1.0.

## Conventions

- **JSON in, JSON out.** File and entry paths travel in the query string or the body, never as an address segment, relative to the site's folder with \`/\` separators: \`?path=src/content/journal/why-we-make-forty.md\`.
- **Who may call.** A few routes answer anyone (*No sign-in* below): \`GET /api/meta\`, sign-in, sign-out, and on a hosted install the three one-time-link routes, where the link's code is the proof. Every other route needs a session: the browser's session cookie, or \`Authorization: Bearer <token>\`. On your own computer the token is the one in the link Galley prints (set your own with \`GALLEY_TOKEN\`, 16 characters or more); in hosted mode set \`GALLEY_TOKEN\` on the server to allow Bearer access at all.
- **Roles, on a hosted install.** Each person who signs in is an owner, an editor or a contributor, and the *Who* column is the level each route needs there, read from the one table the server enforces ([\`packages/core/src/install/route-access.ts\`]({repository}/blob/main/packages/core/src/install/route-access.ts)): *Any signed-in person*, *Editors and owners*, or *Owners*. Someone signed in below a route's level gets \`403\`. *First run* routes take the one-time setup code as the Bearer token until the first owner exists, and need an owner after that. The operator's \`GALLEY_TOKEN\` reaches every route except those that need a person: your own account, people (it may sign one person out), backups, restores and opening the preview. **The levels apply only on a hosted install:** the app on your own computer has one person, who may call every route.
- **State-changing requests** (\`POST\`, \`PUT\`, \`PATCH\`, \`DELETE\`) also need the Bearer token, or a same-origin \`Origin\` header. Request bodies are limited to 40 MB.
- **Site routes** (\`/api/sites/:siteId/…\`) run with that site's own keys and author when it has them ([Look after many sites](/docs/editing/many-sites/)).
- **Addresses under \`/api/x/\`** are not Galley's and are not on this page: they belong to whoever built the edition of the editor you are talking to ([Embedding the editor](/docs/running/embedding/)).
- **Errors** are \`{ "error": { "code", "message", "detail"? } }\` with a matching status. \`message\` is written for a person; \`detail\` carries the technical cause when it is safe to show.

| \`code\` | Status | Means |
| --- | --- | --- |
| \`invalid\` | 400 | Bad input, named: *“url” isn't right: it must be an https or ssh address.* |
| \`unconfigured\` | 400 | Something needs setting up first — a key, an image provider. A host refusing a key is also \`unconfigured\`, never 401. |
| \`unauthorized\` | 401 | No session, or a Bearer token that isn't valid. |
| \`forbidden\` | 403 | Not writable in this mode, outside the site, a failed Host or Origin check, or (on a hosted install) a role below the route's level. |
| \`not-found\` | 404 | No such site, entry, file, job, conversation or route. |
| \`conflict\` | 409 | The file changed since it was read (\`baseHash\`), or a name is taken. |
| \`busy\` | 409, or 429 for too many tries | Something is already running — a reply, a publish — or too many tries at signing in, a setup code or a one-time link. |
| \`git\`, \`preview\`, \`internal\` | 500 | A git command, the preview, or something unexpected failed. |
| \`ai\` | 502 | The model or image provider failed. |

\`\`\`sh
curl -s -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/sites
\`\`\`

In the tables, *Takes* is the query (\`?…\`) and body; *Returns* is the response type, both named as in \`api.ts\`. A response of *a file* or *a stream* isn't JSON.

Addresses outside \`/api\` have their own rules: \`/mcp\` (the [MCP endpoint](/docs/integrations/mcp/), Bearer only), \`/f/:siteId\` (form submissions from the site's own pages — [Forms for developers](/docs/forms/)), and on a hosted install \`/healthz\` and \`/readyz\`, which answer anyone and say nothing about the install ([Run a hosted install](/docs/running/hosted/#health-logs-and-stopping)).`;

const OUTRO = `## Events

\`GET /api/events\` is a Server-Sent Events stream: a \`hello\` event first, then every event as \`data: <json>\`, and a \`: heartbeat\` comment every 20 seconds. Event \`type\`s: ${"{EVENTS}"}. Their shapes are \`ServerEvent\` in [\`packages/core/src/types.ts\`]({repository}/blob/main/packages/core/src/types.ts). \`extension\` is an event of a program that [embeds the editor](/docs/running/embedding/): none is sent by Galley as it ships. \`changes.updated\` carries its origin: \`user\`, \`agent\`, \`external\`, \`publish\`, \`discard\` or \`undo\`. On a hosted install one account (or the operator's token) may hold 16 streams open. One more is answered with a stream that carries a single \`stream.limit\` event (its \`message\` says so in words) and ends; at most once in 10 minutes it is let in instead and the account's other streams are ended, so ones nobody reads any more give up their place. A stream whose reader stops reading is ended once 1 MB is waiting for it: connect again and read what you need afresh.

\`\`\`sh
curl -sN -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/events
\`\`\`

## Next

- [Security](/docs/running/security/) — what a session can do, and what a hosted install adds.
- [Environment variables](/docs/reference/environment/) — \`GALLEY_TOKEN\` and the rest.`;

/**
 * Each level in ROUTE_ACCESS, in plain words. "restore" reads as first run:
 * the setup code until an owner exists, an owner after that.
 */
const WHO = {
  public: "No sign-in",
  setup: "First run",
  restore: "First run",
  edit: "Any signed-in person",
  publish: "Editors and owners",
  manage: "Owners",
};

/** Routes whose callers the level alone doesn't say. */
const WHO_FOR = {
  "GET /api/people/by-identity": "The server's access token",
};

/** ROUTE_ACCESS read from route-access.ts as written: route key to level. */
function readAccess(repoRoot) {
  const path = join(repoRoot, "packages/core/src/install/route-access.ts");
  const sourceFile = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = sourceFile.statements
    .filter((s) => ts.isVariableStatement(s))
    .flatMap((s) => s.declarationList.declarations)
    .find((d) => d.name.getText(sourceFile) === "ROUTE_ACCESS");

  if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) throw new Error("ROUTE_ACCESS was not found in packages/core/src/install/route-access.ts.");
  const access = new Map();

  for (const p of declaration.initializer.properties) {
    if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) access.set(p.name.getText(sourceFile).replace(/^"|"$/g, ""), p.initializer.text);
  }
  return access;
}

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
  const access = readAccess(repoRoot);
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
      who: WHO_FOR[key] ?? WHO[access.get(key)] ?? null,
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
  const unlevelled = routes.filter((r) => !r.who).map((r) => r.key);

  if (unlevelled.length) throw new Error(`these routes have no known level in packages/core/src/install/route-access.ts: ${unlevelled.join(", ")}`);
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
