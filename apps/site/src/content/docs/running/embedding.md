---
title: Embedding the editor
description: Build your own edition of the editor. A program that starts Galley's server can add API routes of its own, each with an access level, behind the editor's own guards. Experimental.
group: running
order: 6
---

A program of your own can start Galley's server and add to it. This page is for developers who build their own edition of the editor: a status page, a button that files a request, a hook into a system the team already uses.

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

Every route says who may call it: `access` is `edit`, `publish` or `manage`, the [same three levels](/docs/running/hosted/) the editor's own routes have. There is no route without a level and none for someone who isn't signed in. On an install with accounts, a route with `person: true` also refuses the operator's access token.

Before your handler runs, the request has passed everything a request to the editor's own API passes (the `Host` check, the size limit, the same-origin check on what changes state, the session and the level), and two checks more:

- **Where it came from.** With a session cookie, the browser must say the request comes from the editor's own page (`Sec-Fetch-Site: same-origin`, or `none`). The same-origin check doesn't cover GET, and a page on a neighbouring hostname is sent the cookie. A script with the operator's token is exempt. Two things follow:
  - `none` is what a browser sends for an address typed by hand, and also for a link opened from outside it, such as one in an e-mail. So a link someone is sent can call a GET route of yours as them. One more reason a GET must change nothing.
  - A browser that doesn't send `Sec-Fetch-Site` at all is refused, on the editor's own page too. Every current browser sends it; some older ones don't.
- **What a part of the address may be.** A `:name` in your path never holds a `/`, a `\` or a NUL, and is never `.` or `..`: such a request is answered 400. Take a file's path in the query or the body, and **treat it as unchecked**: a value there can hold `../` and arrives fully decoded. Never join one onto `host.stateDir` or any path you open yourself. Hand it only to `site`, which keeps it inside the site.

**GET changes nothing.** That is the rule for every route of the editor: a GET is called again by browsers and proxies without anyone asking, and `HEAD` runs your GET handler too. On GET, every site your handler reaches (the one it is handed, any it asks `host.sites` for, one it kept from earlier) refuses whatever would change it. That holds for the GET and for everything the GET starts, `host.outside` included: a job first started from inside a GET stays read-only for as long as it runs. Work started somewhere else (in `setup`, by another route) is not read-only, whatever later asks it to do something. So start long-running work in `setup`. Your own state is yours to keep to the rule.

### What a handler is handed

Six things: `params`, `query`, `body` (what your `body` reader returned; the reader may be async), `caller`, `site` (when the path has `:siteId`) and `signal`. Not the cookie, not the headers, not the framework's request. It returns JSON; what plainly isn't JSON (a response of your own, `undefined`, a number JSON can't hold, a loop) is answered as a server error and logged.

A parsed body is what `JSON.parse` made of it: a key called `__proto__` is an ordinary key there, and becomes something else if you merge the object into another. Read the fields you expect and leave the rest.

- `caller` is `{ kind: "person", account, role, name, session }`, `{ kind: "operator" }` for the operator's token, or `{ kind: "local" }` where there are no accounts. Account ids are shown to owners only in the editor's own interface: don't send them to everyone's browser.
- `site` is the same site the editor's own routes use, with five differences.
  - It can't be closed.
  - What it answers with is a copy, from a change as from a read, so nothing you do to an answer changes the site's own rules. Plain data is copied (a file's content, a listing, the model), which costs what copying costs: don't read a large file in a loop. A thing to drive (the preview's controller, a checkpoint) is the engine's own, handed behind the same guards as the site: it can be kept, and it keeps the site's rules. Inside a GET the preview's status can be read and it can't be started, stopped or restarted, and a checkpoint can be read and can't put back what it recorded; once your extension has been stopped, none of their methods works.
  - `.git/` and secrets files (any file whose name starts with `.env`) can't be read through it: by name, as the editor's own file routes refuse them, and, for reads that name a file and for what a search finds, by where a link inside the site leads. Other spellings a file system may accept, and hard links, are not caught.
  - On GET it refuses to change anything.
  - It stops with your extension: once the extension has been stopped, every member of every site it was handed refuses.

  What it changes, it changes as the caller: build mode needs an editor, the site's settings an owner, publishing a name.
- An error you throw with `invalid(…)`, `notFound(…)` or `forbidden(…)`, from the handler or from the body reader, is shown to the person in those words. Only the editor's own check answers "not signed in" (401), because the app sends people to sign in when it sees one: whatever of yours says 401 is answered 403.
- `signal` fires when whoever asked gave up. A listener you put on it (or on `setup`'s) must not throw: Node ends the process for one that does.

### Whose work it is

While your handler runs, it works as its caller. **Once it has answered, anything it left running has lost its caller's access**, and at once when the caller's sign-in stops counting (each is refused in a sentence that says which). That is on an install with accounts, and for the operator's token on a hosted install; where there are no accounts, every request is the one person's at that computer, and work left running goes on as theirs. On a hosted install such work may not publish, use build mode or change the site's settings; it may still save content. One thing stays: the publishing name follows the work, as it does for any request, so what such work records still carries the name of the person whose request started it. To start work that outlives a request and is nobody's in name as well, use `host.outside(() => …)`.

Everything else of yours that the server calls (`setup`, `stop`, a listener) is called as nobody.

## People

On an install with accounts, `host.people` answers two questions: `name(account)` and `counts(session)`, whether a sign-in still counts (not signed out, its account there and switched on). `onChange(listener)` runs when either answer may have changed. A listener answers at once; one that returns a promise is logged and ignored. An extension is never handed an e-mail address, a password hash or a cookie.

`counts` can turn false early, never true late: a sign-in from before the server last started doesn't count for an extension, and nor does one pushed out of the server's memory by thousands of newer ones.

## Secrets, files, and one server to a process

- **Secrets.** Name the environment variables your extension reads that are secret in `secrets`, as a list. A variable every program needs (`PATH`, `HOME`, `NODE_OPTIONS` and the like) can't be named: the server won't start. On a hosted install they are kept from the site's own commands, from before anything is started (its preview and build run the site's code, which editors can change). On your own computer a site's commands get your shell's environment as they always have. Everywhere, their values are taken out of every line the server logs and of the error messages your routes answer with. Know the limits: a value under six characters is never taken out, an encoded form of a value (in a URL, in base64) is not recognised, and a variable you don't name is not covered at all.
- **Files.** `host.stateDir` is a folder of your extension's own under the data folder. It is in backups, and a restore replaces it under a running server: **restart your program after a backup is put back**.
- **One server.** A server with extensions must be the only server running in its process. Some of the editor's settings belong to the process, and a second server would change them under the first.
- **Starting and stopping.** `setup` has 30 seconds and is handed a signal that fires when they are up. If it fails, or what it returned turns out wrong, the server doesn't start: `startServer` rejects with that error, your `stop` is called if your setup had finished, everything the server had started is undone, and **your program should exit**. `stop` is called when the server stops, while the data folder is still its own. After it, what the extension was handed does nothing: its host, every site it holds, and anything it took from one (the preview's controller), whenever it got them.

## Getting the code

`@galley/server` is not published as a package. Put the Galley repository inside your own workspace, **pinned to a commit**, and build from source. That has costs you should know:

- Your lockfile, not Galley's, decides the versions of its dependencies. Before it starts with extensions, the server checks four things about how the router it was given reads an address (the four the guards above rest on) and refuses to start if one is different. That is not every way a router can differ: keep `hono` and `@hono/node-server` at the versions the release you pinned was built with.
- Building from source runs Galley's development tools in your build.
- Security fixes reach you when you move your pin. Watch the repository's releases and security advisories; only the latest minor version gets fixes, and taking one may mean taking a change to the shapes on this page.
- What [the security model](/docs/running/security/) says about the container image is about Galley's own image, not yours.
