---
title: Embedding the editor
description: Build your own edition of the editor. A program that starts Galley's server can add API routes of its own, each with an access level, behind the editor's own guards. Experimental.
group: running
order: 6
---

A program of your own can start Galley's server and add to it. This page is for developers who run the editor for other people and want something of their own in it: a status page for a client, a button that files a request, a hook into the system the team already uses.

**Experimental.** The shapes on this page may change in any 0.x release; the changelog says so under "Embedding". What does not change: addresses under `/api/x/` are reserved for whoever built the edition.

Today an embedding can add **API routes**. Live events and places in the interface are planned.

## What it is, and what it is not

An extension is code you compile into the server. It is fixed in your program's source: nothing read at run time (the environment, the data folder, a site's settings, a request) can add one, and `galley serve` has no flag for it.

```ts
import { startServer } from "@galley/server";
import { defineExtension, invalid } from "@galley/server/extensions";

const status = defineExtension({
  id: "status",
  secrets: ["STATUS_SERVICE_TOKEN"],
  setup(host) {
    const notes = new Map<string, string>();

    return {
      routes: {
        // GET /api/x/status/sites/:siteId — anyone who can edit
        "GET /sites/:siteId": {
          access: "edit",
          async handle({ site }) {
            return { waiting: (await site!.changes()).files.length, note: notes.get(site!.id) ?? null };
          },
        },
        // POST /api/x/status/sites/:siteId/note — anyone who can publish
        "POST /sites/:siteId/note": {
          access: "publish",
          body(input) {
            const text = (input as { text?: unknown } | null)?.text;
            if (typeof text !== "string" || !text.trim() || text.length > 200) throw invalid("A note is 1 to 200 characters.");
            return { text: text.trim() };
          },
          async handle({ site, body }) {
            notes.set(site!.id, body.text);
            return { ok: true };
          },
        },
      },
    };
  },
});

await startServer({ mode: "hosted", extensions: [status] });
```

**An extension is not sandboxed.** It runs in the server's process with the server's permissions, your files and the network, exactly like the server's own code and like an installed plugin. What Galley promises is narrower: what an extension is *handed*, what the server does for it, and that a wrong declaration stops the server from starting. A mistake in your extension's own code is yours.

For what a *site* can use (an image provider, a place to publish, a tool for the assistant), write a [plugin](/docs/plugins/) and compile it in. A plugin adds what a site can do; an extension adds to what the editor program is.

## Routes

A route is `"<METHOD> /path"`, relative to your extension. It is served at `/api/x/<id>/…`, and no address of the editor's own is under `/api/x/`, so a route of yours can never replace one of Galley's.

Every route says who may call it: `access` is `edit`, `publish` or `manage`, the [same three levels](/docs/running/hosted/) the editor's own routes have. There is no route without a level and none for someone who isn't signed in. A route with `person: true` also refuses the operator's access token.

Before your handler runs, the request has passed everything a request to the editor's own API passes (the `Host` check, the size limit, the same-origin check on what changes state, the session and the level), and two checks more:

- **Where it came from.** With a session cookie, the browser must say the request comes from the editor's own page (`Sec-Fetch-Site: same-origin`, or `none` for an address typed by hand). The same-origin check doesn't cover GET, and a page on a neighbouring hostname is sent the cookie. A script with the operator's token is exempt.
- **What a part of the address may be.** A `:name` in your path never holds a `/`, a `\` or a NUL, and is never `.` or `..`: such a request is answered 400. Take a file's path in the query or the body.

**GET changes nothing.** That is the rule for every route of the editor, and a GET is called again by browsers and proxies without anyone asking. On GET the site your handler is handed refuses whatever would change it.

### What a handler is handed

Six things: `params`, `query`, `body` (what your `body` reader returned), `caller`, `site` (when the path has `:siteId`) and `signal`. Not the cookie, not the headers, not the framework's request. It returns JSON; anything else is answered as a server error and logged.

- `caller` is `{ kind: "person", account, role, name, session }`, `{ kind: "operator" }` for the operator's token, or `{ kind: "local" }` where there are no accounts. Account ids are shown to owners only in the editor's own interface: don't send them to everyone's browser.
- `site` is the same site the editor's own routes use, with three differences: it can't be closed, `.git/` and `.env*` can't be read through it, and on GET it refuses to change anything. What it changes, it changes as the caller: build mode needs an editor, the site's settings an owner, publishing a name.
- An error you throw with `invalid(…)`, `notFound(…)` or `forbidden(…)` is shown to the person, in those words.

### Whose work it is

While your handler runs, it works as its caller. **Once it has answered, anything it left running is nobody's**, and at once when the caller's sign-in stops counting. On a hosted install nobody may not publish, use build mode or change the site's settings; nobody may still save content. To start work that outlives a request, use `host.outside(() => …)`.

Everything else of yours that the server calls (`setup`, `stop`, a listener) is called as nobody too.

## People

On an install with accounts, `host.people` answers two questions: `name(account)` and `counts(session)`, whether a sign-in still counts (not signed out, its account there and switched on). `onChange(listener)` runs when either answer may have changed. A listener answers at once; one that returns a promise is logged and ignored. An extension is never handed an e-mail address, a password hash or a cookie.

## Secrets, files, and one server to a process

- **Secrets.** Name the environment variables your extension reads that are secret in `secrets`. On a hosted install they are kept from the site's own commands (its preview and build run the site's code, which editors can change), and they are scrubbed from your `host.log` lines and from the error messages people see. One you don't name is not.
- **Files.** `host.stateDir` is a folder of your extension's own under the data folder. It is in backups, and a restore replaces it.
- **One server.** A server with extensions must be the only server running in its process. Some of the editor's settings belong to the process, and a second server would change them under the first.
- **Starting and stopping.** `setup` has 30 seconds and is handed a signal that fires when they are up. If it fails, the server doesn't start. `stop` is called when the server stops, while the data folder is still its own.

## Getting the code

`@galley/server` is not published as a package. Put the Galley repository inside your own workspace, **pinned to a commit**, and build from source. That has costs you should know:

- Your lockfile, not Galley's, decides the versions of its dependencies. The server checks the router it was given before it starts with extensions, and refuses one that reads addresses differently.
- Building from source runs Galley's development tools in your build.
- Security fixes reach you when you move your pin. Watch the repository's releases and security advisories; only the latest minor version gets fixes, and taking one may mean taking a change to the shapes on this page.
- What [the security model](/docs/running/security/) says about the container image is about Galley's own image, not yours.
