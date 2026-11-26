---
title: Embedding the editor
description: Build your own edition of the editor. A program that starts Galley's server can add API routes and live events of its own, each with an access level, behind the editor's own guards, follow what happens to a site, and draw in fifteen places of the app. Experimental.
group: running
order: 6
---

A program of your own can start Galley's server and add to it. This page is for developers who build their own edition of the editor: a status page, a button that files a request, a hook into a system the team already uses.

**Experimental.** The shapes on this page may change in any 0.x release; the changelog says so under "Embedding". What does not change: addresses under `/api/x/` are reserved for whoever built the edition.

An embedding can add **API routes** and **live events**, be told that a window is there, **follow what happens to a site** (and refuse a discard, or hold a file's turn), and draw in **fifteen places of the app**, outlines on the previewed page included.

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
      events: {
        // Every open window whose reader can edit hears that the note changed.
        changed: { level: "edit" },
      },
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
            host.events.emit("changed", site!.id, { note: body.text });
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
- `site` is the same site the editor's own routes use, with five differences and one warning.
  - It can't be closed.
  - What it answers with is a copy, from a change as from a read, so nothing you do to an answer changes the site's own rules. Plain data is copied (a file's content, a listing, the model), which costs what copying costs: don't read a large file in a loop. A thing to drive (the preview's controller, a checkpoint) is handed as a plain object with its public members only, each going to the engine's own behind the same guards as the site, and what they answer is copied too: it can be kept, and it keeps the site's rules. Call a checkpoint's `release()` once you no longer offer its undo; one you never let go of is let go an hour after it was closed. Inside a GET the preview's status can be read and it can't be started, stopped or restarted, and a checkpoint can be read and can't put back what it recorded; once your extension has been stopped, none of their methods works.
  - `.git/` and secrets files (any file whose name starts with `.env`) can't be read through it: by name, as the editor's own file routes refuse them, and, for reads that name a file and for what a search finds, by where a link inside the site leads. Other spellings a file system may accept, and hard links, are not caught.
  - On GET it refuses to change anything.
  - **Don't keep it.** The server closes a site that nothing has used for an hour (unless its preview is running, a job is, or an Undo is still offered on it), when it is removed, when a backup is put back, and when the server stops. A site you kept from before then refuses every call, in one sentence (*This site has been closed, so it can't be used from here any more. Open it again to go on.*). A preview controller taken from it won't start or restart the preview again (the same sentence), though its status can still be read. A checkpoint taken from it can't put anything back: it says the site was closed. Ask `host.sites.get(siteId)` each time you need a site outside a request: asking counts as use, and what you are handed is the site as it is open now.
  - It stops with your extension: once the extension has been stopped, every member of every site it was handed refuses.

  What it changes, it changes as the caller: build mode needs an editor, the site's settings an owner, publishing a name.
- An error you throw with `invalid(…)`, `notFound(…)` or `forbidden(…)`, from the handler or from the body reader, is shown to the person in those words. Only the editor's own check answers "not signed in" (401), because the app sends people to sign in when it sees one: whatever of yours says 401 is answered 403.
- `signal` fires when whoever asked gave up. A listener you put on it (or on `setup`'s) must not throw: Node ends the process for one that does.

### Whose work it is

While your handler runs, it works as its caller. **Once it has answered, anything it left running has lost its caller's access**, and at once when the caller's sign-in stops counting (each is refused in a sentence that says which). That is on an install with accounts, and for the operator's token on a hosted install; where there are no accounts, every request is the one person's at that computer, and work left running goes on as theirs. On a hosted install such work may not publish, use build mode or change the site's settings; it may still save content. One thing stays: the publishing name follows the work, as it does for any request, so what such work records still carries the name of the person whose request started it. To start work that outlives a request and is nobody's in name as well, use `host.outside(() => …)`.

Everything else of yours that the server calls (`setup`, `stop`, a listener, an event's `for`) is called as nobody, whoever's request led to the call.

## Events

The editor has one live stream, `GET /api/events`, which every open window reads. An extension can send events of its own on it.

Declare each event by name beside your routes, with the least a reader's role must have to be sent it. A name is lower-case words joined by dots. Then send one with `host.events.emit(name, siteId, payload)`:

```ts
events: {
  // Who left the note is for those who may publish; a contributor is sent the note alone.
  changed: {
    level: "edit",
    for: (payload: { note: string; by: string }, reader) =>
      reader.kind === "person" && reader.role === "contributor" ? { note: payload.note } : payload,
  },
},
```

A window receives:

```json
{ "type": "extension", "source": "status", "name": "changed", "siteId": "…", "payload": { "note": "Ready for Monday", "by": "Ed" } }
```

- **The envelope is the server's.** `type`, `source` (your extension's id), `name` and `siteId` are filled in by the server, and your payload stays under `payload` whatever keys it has. So an extension can't send one of the editor's own events, or speak as another extension. These five keys stay.
- **Who is sent it.** A reader is sent an event only if their role, *as it is at that event*, has the event's `level`: someone made a contributor a minute ago is a contributor for the next event, with their window still open. A reader is a sign-in that still counts, by the test a request is held to: someone signed out is sent nothing more, no `for` is asked about them, and their stream ends. The operator's token has every level, and so has the one person of an install without accounts.
- **`for` narrows.** Where an event has one, it is asked what each reader is sent: the payload, less of it, or `null` for nothing. It is never asked about a reader below the level, so it can narrow and never widen. It is handed the reader as a `caller` is, and a copy of the payload that is this reader's alone: what it does to one copy reaches no other reader. Without `for`, every reader with the level is sent the payload as it is.
- **`for` answers at once.** A promise, `undefined`, something that isn't JSON, more than 64 KB or an exception sends that reader nothing. The log says so, though not once for every reader: a line a minute at most for each event and each of two kinds of failure (it threw or answered with a promise; what it answered can't be sent). What it answers is copied before it is measured, and the copy is what is sent. It is called once for every reader of every event, so keep it cheap; and it is called on a copy of your rule, so it can't use `this`.
- **What `emit` refuses,** by throwing where you called it: a name you didn't declare; a site your extension hasn't been handed (by a route with `:siteId`, or by `host.sites`; a hosted install's one site is always allowed); a payload that isn't JSON or is over 64 KB; any event before `setup` has returned.
- **So many a second.** In any one second (counted on a clock that only moves forward, not the one on the wall) an extension may send 50 events and 256 KB of payload. Past either, its events are dropped, without an error where you called, and the log says how many (a second after the first, then once a minute at most).
- **A window that is behind misses your events, not the editor's.** A window may have 1 MB waiting that it hasn't read; past that it is let go, and connects again. An extension's event is never what takes it there: when a window already has half of that waiting (512 KB), an extension's event is left out for that window, and the log counts it. The editor's own events are never left out. **A window can miss your events without ever being disconnected**, so nothing reconnects and `onReconnect` doesn't run. It is told instead: once it has room again, it is sent `{ "type": "extension", "source": "<id>", "name": "stream.missed", "siteId": "", "payload": { "count": 72 } }`, once for each extension it missed events of. So treat your events as hints that may be missed: send what changed, and have the window ask your route for what it shows when it hears `stream.missed`, as it does after `onReconnect`.
- A payload goes to browsers. Don't put a secret in one, and remember that account ids are for owners.

## Knowing a window is there

Some extensions need to know that a browser window is still open: to free something when the last one goes, or to show that someone is on a page. The window's stream is the sign to go by: it opens when the window connects and ends when the window's connection does. So there is no heartbeat route to write.

The client adds a value for your extension to the stream's address, `/api/events?x-status=tab-7f3a`, and your extension listens:

```ts
host.events.onStream(({ caller, value }) => {
  windows.set(value, caller);
  // Runs once when that stream ends, however it ends.
  return () => windows.delete(value);
});
```

- **The value** is 1 to 128 characters of `A-Z a-z 0-9 . _ ~ -`; anything else is answered for you and never reaches your listener. It is untrusted: any signed-in browser chooses it, so two windows can send the same one. A proxy in front of the server writes it in its access log, so it must not be a secret. `caller` is the server's word for who is at the window.
- **Only from the editor's own page.** Unless the request carries the operator's token, a value is taken only when the browser says the request is the editor's own page's (the check a route of yours passes). From anywhere else the value is refused like one you refused yourself, your listener is never told, and the stream opens as one without a value does. So a page on another origin can't make it look as if someone were there, and a browser that doesn't say where a request is from keeps its live updates and loses only the value.
- **You can refuse the value, never the stream.** Throw `forbidden(…)` or `invalid(…)` from the listener and the window is sent `{ "type": "extension", "source": "status", "name": "stream.refused", "siteId": "", "payload": { "code": "forbidden", "message": "…" } }` right after its stream opens; the stream opens as usual. There is one stream for the whole app, and a browser can't read why one failed: it would ask again for ever, and every screen would lose its live updates. A listener that fails any other way refuses the value in general words, and the log has the reason (now and then, not each time). A refusal's words go to a browser: one line of them, 500 characters at most, your declared secrets taken out. What a listener handed back is not called for a value that was refused; if your extension has several listeners and a later one refuses, what the earlier ones handed back runs at once. Names that begin with `stream.` are the server's own, which no extension can declare.
- **Listeners answer at once**: a promise is logged and its answer is not used. What a listener is told can't be changed, and each extension is told with an object of its own.
- **Too many windows.** On a hosted install one account may have 16 streams open. One that is told there are too many never reaches your listener. When an account's streams are ended to make room, each of them is told to you as ended, and the windows still there connect again.
- **What it doesn't say.** A stream ends when a window closes or its connection drops, and a browser then opens another by itself: expect the same value to go and come back. A window that goes without a word (a laptop closed, a connection lost behind a proxy) is only known to have gone when its connection is found dead, which can take minutes. And an open stream says a window is connected, not that someone is looking at it.

In the app, your addition sets the value with `setStreamValue` ([below](#in-the-app)). The app as it ships sets none.

## People

On an install with accounts, `host.people` answers two questions: `name(account)` and `counts(session)`, whether a sign-in still counts (not signed out, its account there and switched on). `onChange(listener)` runs when either answer may have changed. A listener answers at once; one that returns a promise is logged and ignored. An extension is never handed an e-mail address, a password hash or a cookie.

`counts` can turn false early, never true late: a sign-in from before the server last started doesn't count for an extension, and nor does one pushed out of the server's memory by thousands of newer ones.

## Following what happens to a site

`host.hooks` tells an extension what happens to the open sites. Each of its four functions returns one that stops it, and everything stops with the extension. A listener is handed a copy, is called as nobody, and must answer at once: a file's listeners are called while its write waits, a promise is logged and not waited for, and an error is logged. None of them can fail a write or an action.

- **`onFileWrite(listener)`**, right after a file is written or removed on any open site: `{ siteId, path, origin, beforeHash, afterHash, removed, actor }`. `origin` is `user`, `agent` or `undo` for the editor's own writes, and `external` for a change from outside the app (another program, Get latest, catching up), which comes with no `beforeHash` and with the actor `outside`. A hash is the first 16 hex digits of the file's SHA-256. Files a discard or an undone publish puts back are not told one by one. **Secrets files (`.env…`) and `.git/` are never told**, as the site an extension is handed never reads them. While no extension listens, nothing is hashed for it.
- **`onActivity(listener)`**, when a publish, a discard, an undone publish (`revert`), Get latest (`pull`), a look at what is new on the code host (`check`) or a catch-up starts, and when it ends: `{ siteId, kind, phase, actor }`, with the paths and the commit where there are some. An end carries `failed: true` when it stopped with an error, and, for a publish or an undone publish, when it answered that it failed without one: refused, or committed here and not pushed.
- **`beforeDiscard(guard)`**, before a discard, with the site, the paths (every waiting path for "discard all") and the actor. A guard that answers with a sentence refuses it: nothing is discarded, and the person is shown that sentence (403), as one line of at most 500 characters with your declared secrets taken out. Guards are asked one after another and the first refusal wins. **A guard fails closed**: one that throws, or doesn't answer within five seconds, refuses the discard (*A check this editor runs before a discard couldn't give its answer, so nothing was discarded. Try again in a moment.*), and the log says why. The paths are as asked; the discard may then leave out some (an unchanged file, a secrets file).
- **`onAssistantTurn(listener)`**, when an assistant's turn starts (`start`), each time one of its tools starts or finishes once the turn has changed a file (`write`, with every file changed so far), and when the turn ends, however it ended (`end`, with the same): `{ siteId, threadId, turnId, phase, actor, paths }`.

`actor` says who did it: a person (`accountId`, `role`, and `viaPreview` for a change asked from the previewed page), the operator's token, the engine, or `outside`. Account ids are for owners, as [above](#what-a-handler-is-handed).

### Holding a file's turn

`host.sites.withPathLock(siteId, path, run)` runs `run(site)` while it holds the turn the editor's own edits of that file take (saving an entry, making or deleting one, saving or deleting a file), so those wait until `run` has finished. Inside `run`, the site's own edits of that file go straight through, as does `withPathLock` again on the same path. The site is handed as `host.sites.get` hands it. It is refused inside a GET, once the extension has stopped, for a path under `.git/`, a secrets file or a path that climbs out of the site, and for a site that isn't open.

It doesn't keep the file still: a discard, Get latest, an undone publish, an assistant's Undo and edits made outside the app don't take that turn. Take one path at a time: holding two, in one order here and the other order somewhere else, can wait forever. And don't publish, undo a publish or get the latest from inside `run`.

## Secrets, files, and one server to a process

- **Secrets.** Name the environment variables your extension reads that are secret in `secrets`, as a list. A variable every program needs (`PATH`, `HOME`, `NODE_OPTIONS` and the like) can't be named: the server won't start. On a hosted install they are kept from the site's own commands, from before anything is started (its preview and build run the site's code, which editors can change). On your own computer a site's commands get your shell's environment as they always have. Everywhere, their values are taken out of every line the server logs and of the error messages your routes answer with. Know the limits: a value under six characters is never taken out, an encoded form of a value (in a URL, in base64) is not recognised, and a variable you don't name is not covered at all.
- **Files.** `host.stateDir` is a folder of your extension's own under the data folder, and it is in backups. A restore replaces the data folder under a running server, so the server stops your extension first and starts it again afterwards (below). What a backup holds is what comes back: keep there only what should travel with the install.
- **One server.** A server with extensions must be the only server running in its process. Some of the editor's settings belong to the process, and a second server would change them under the first.
- **Starting and stopping.** `setup` has 30 seconds and is handed a signal that fires when they are up. If it fails, or what it returned turns out wrong, the server doesn't start: `startServer` rejects with that error, your `stop` is called if your setup had finished, everything the server had started is undone, and **your program should exit**. `stop` is called when the server stops, while the data folder is still its own. After it, what the extension was handed does nothing: its host, every site it holds, and anything it took from one (the preview's controller), whenever it got them. What your code opened itself (a file in your folder, a timer, a connection) is yours to close: `stop` should wait for your own work to finish, and a `setup` that throws, or whose signal fires, must clean up what it had started. One that finishes after its time was up has its `stop` called then, in its turn: never in the middle of another start or stop. That can be while a newer start of your extension is already running, or after the server has stopped and let go of the data folder. So a `stop` closes only what its own `setup` opened, and doesn't count on the folder.
- **When a backup is put back.** A restore that is refused before anything is touched (a wrong passphrase, a damaged file) never reaches your extension. Otherwise `stop` is called before the data folder is replaced, with your folder still as you left it, and when the restore has ended, whichever way, `setup` is called again with a new host: read your files afresh, because they may be the backup's now, and what you kept in memory is from before. **The routes `setup` returns must be the ones it returned when the server started**: the same addresses, each with the same level, size limit and `person`. An address keeps the guards it was mounted with, so an extension that comes back with other routes is stopped; its events may differ. The restore doesn't say how it ended, and requests are answered 503, until every extension has started again. If yours can't, the server carries on without it: its routes answer 503 until the server is restarted, and the log says why. Then every stream that carried a value for an extension is ended, so each window opens another and the extension running now is told it is there. A restore that succeeds signs everyone out, so people's streams have ended by then and they are told again once they have signed in. A `stop` that fails, or takes longer than its ten seconds, doesn't stop the restore.

## In the app

The browser half of an extension is an **addition**: what your edition draws in the app. Additions are given to the app's root component in your program's entry file and nowhere else. No setting, address, message or stored value adds one.

```tsx
import "@galley/web/styles";

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@galley/web/app";
import { extensionApi, onReconnect, subscribeExtension, useSiteId, type Addition } from "@galley/web/additions";
import { Badge } from "@galley/web/ui";

const status = extensionApi("status");

function Waiting() {
  const siteId = useSiteId();
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    if (!siteId) return;
    const load = () =>
      void status
        .get<{ waiting: number }>(["sites", siteId])
        .then((answer) => setWaiting(answer.waiting))
        .catch(() => undefined);
    // Asked again when it changed, when the stream came back, and when the server says this window missed some events.
    const stops = [subscribeExtension("status", "changed", load), subscribeExtension("status", "stream.missed", load), onReconnect(load)];

    load();
    return () => stops.forEach((stop) => stop());
  }, [siteId]);
  return waiting ? <Badge tone="change">{waiting} waiting</Badge> : null;
}

const statusAddition: Addition = { id: "status", topBar: Waiting };

createRoot(document.getElementById("root")!).render(<App additions={[statusAddition]} />);
```

### Places

Fifteen, in this version:

- `root`: mounted once inside the signed-in app, and again when someone else signs in. For what the addition keeps going (a subscription, the stream's value). It should draw nothing, or little.
- `topBar`: at the right of the top bar, before the account menu. Small.
- `listRow`: after the title in each row of a collection's list, and of the list of changes on a site's home, handed `siteId` and the page's `path`. It is drawn once for every row on screen, and again as the list scrolls, so keep it cheap: one request for the whole list, not one a row (share it between rows, outside the component). What it draws can be clicked. The list is moved through with the arrow keys and has one tab stop; anything of yours that takes focus adds a tab stop for every row, so prefer what doesn't, or give it `tabIndex={-1}`.
- In an open entry's form, each handed `siteId` and the entry's path:
  - `entrySession`: mounted once for the open entry, for what keeps going while it is open; handed the entry, its collection and the form's store ([below](#the-forms-store-and-its-main-text)). It should draw nothing.
  - `entryTop`: at the top of the form, under the mode bar; handed the store.
  - `fieldHeader` (beside a field's label) and `fieldNotice` (under its control), handed the field's path and its definition.
  - `fieldFrame`: around a field's control, handed it as `children` with the field's path and definition. One that waits shows the control without it; **one that fails shows the control as it was**, without the frame.
  - `sectionHeader`: on the head of each section or list item, handed the list's path, the index and whether it is open.
  - `bodyAddon`: above the main text, handed the store and the main text's editor ([below](#the-forms-store-and-its-main-text)).
- In Proof: `proofRow`, in each changed file's row, beside the row's own button (so what it draws may take a click of its own), handed the path and its status; and `proofDetail`, in the head of a change.
- `publishNotice`: in the Publish dialog above the files, handed the paths chosen.
- `arrangePanel`: in the Arrange panel once the page's sections are found, handed the entry's path, the field and the sections' labels.
- `previewHost`: beside the preview of a page that can be edited, handed the page's sections and `postMarks` ([below](#outlines-on-the-previewed-page)).

With no additions each place renders nothing, and the app is as it ships.

### The form's store and its main text

The store handed to `entrySession`, `entryTop` and `bodyAddon` is the form's own (`FormStore`). Besides reading it, an addition can:

- `store.actions.onEvent(listener)`: be told the form's edits as they are made: `draft` (a field changed, before it is sent; at once for a switch, a picker or a chip), `commit` (a field sent), `body-draft`, `body-commit`, and `received` (a newer copy of the entry put in place). It returns a function that stops it.
- `applyRemote(ops, next)`: put edits it didn't send onto the form's saved copy, keeping what the person is still typing, without asking for the entry again.
- `setTransport({ send, reload })`: send the form's edits and read the entry back another way. `setTransport(null)` puts the form's own back: do that when your addition unmounts.
- `setSuppressReceive(true)`: stop taking newer copies of the entry while your addition brings them in itself; `false` takes them again.

`bodyAddon` is also handed (`BodyAdditionProps`) the main text's CodeMirror `view`, `setExtensions(extensions)` to add CodeMirror extensions, `setReadOnly(readOnly)` (its formatting buttons too), and `setManagedValue(managed)`: take its text over, so the form neither saves what is typed there nor replaces it. These are one set for the main text: when two additions call one, the last call wins.

### Outlines on the previewed page

A `previewHost` addition can outline sections of the page in the preview with `postMarks([{ field, index, color }])`: a 2-pixel line in that colour around each section named, drawn over the page, which never takes a click and holds no text. A colour is `#rgb` or `#rrggbb` and nothing else, an index a whole number from 0, a field at most 200 characters. A message with more than 32 marks, or with one mark that isn't so, is ignored whole. The outlines follow scrolling and resizing; an empty list takes them away, and nothing is drawn while the page's sections can't be matched to the entry's. The page beside it, the site as it is online, ignores them.

An addition's `id` is its extension's: lower-case letters, digits and dashes, 3 to 32, starting with a letter. A wrong id, the same id twice or something that isn't a component stops the app as it starts, in a sentence that names the addition. A component is a function, or what `memo`, `forwardRef` or `lazy` return; an element (`<Badge />` where `Badge` was meant) is refused. The list is read once; changing it later changes nothing.

An addition that waits the first time it draws (a `lazy` component, a promise it reads with `use`) shows nothing in its place until it is ready, and the screen doesn't wait for it. But once it is on screen, an addition that waits *again* holds the move to the next screen until it is ready, because the app's navigations are transitions: read new data in an effect and keep what you draw ready, rather than reading it with `use` on every render.

### What an addition leans on

`@galley/web/additions` exports:

- **`extensionApi(id)`**: a client for your own routes. An address is given as its parts, `status.get(["sites", siteId, "note"])`, and each part is encoded, so a value that came from somewhere else can't become a path. A refusal is thrown with the server's own words in `error.message`; "not signed in" sends the person to sign in, as it does for the app's own calls.
- **`subscribeExtension(id, name, handler)`**: your extension's events, by name. **`onReconnect(listener)`** runs after the stream came back from a drop: fetch again what you show, because events sent meanwhile are gone. Do the same on `subscribeExtension(id, "stream.missed", …)`: the server's word that this window was not sent some of your events while it was behind ([above](#events)).
- **`setStreamValue(id, () => value)`**: the value this window's stream carries for your extension ([above](#knowing-a-window-is-there)). It is asked for each time the stream opens, may be a promise, and has two seconds: past that, or if what it gives isn't a value, the stream opens without it. When the server refuses the value, `subscribeExtension(id, "stream.refused", …)` hears it.
  - **Set it while your `root` mounts** and it is on the stream from the first time it opens. If the value takes a request to work out, hand over a function that returns the promise; setting it later, once you have it, opens the stream a second time on every page load.
  - **Changed later, the stream is opened again with it**, at most once in five seconds however often you ask. Setting the same value again doesn't open the stream again; but every addition's value function, yours and others', is asked again to find out, so keep yours cheap and have it give the same value for the same state — fetch once and return the one promise you kept, not a new request each time.
  - **What opening it again costs.** It counts as the stream coming back: events sent in the gap are missed, every `onReconnect` listener runs, and the app fetches afresh what is on screen. Nothing is shown to the person. So a value should change rarely: a name for the window, not something that follows what the person does.
- **`useSiteId()`**, **`useAccount()`** (the person's name and role; null where there are no accounts) and **`useRoleMay(level)`**. They are for showing the right thing. The server decides again at every request.
- **`useServerEvent`**, **`useConnection`**, **`useChanges`** and **`useSite`**: the app's own server events, the stream's state, a site's waiting changes and the open site. **`notify`** shows a message as the app's own do; **`pathKey`** is how the form names a field's path. The types `FormStore`, `FormStoreEvent` and `BodyAdditionProps` describe what the form's places are handed.
- **`SafeText`** and **`SafeMarkdown`**: for words someone else wrote. An addition often shows a contributor's text to an owner; these are the ways to put it on the page, and `dangerouslySetInnerHTML` is not. The Markdown is small: raw HTML is shown as the text it was typed as, a picture as its description, and only links to web and mail addresses stay links. Both wrap long words. How much to show is yours to decide: clamp a note to a line in a bar or a row, because someone can write five thousand characters.

`@galley/web/ui` is the app's own interface kit (buttons, badges, dialogs, fields) with the theme's tokens.

### What this is not

- **Not a sandbox.** An addition is part of the one bundle. It can import any module of the app (everything the app knows about the person, not only what `useAccount` hands over), cover a screen, block the page by being slow, or fail in a click handler. Three things the app does for it:
  - An addition that fails *while it draws* shows nothing in that place, and the screen around it stays; a `fieldFrame` leaves the field's control as it was. The app names the failing addition and the place once in the console. React also logs every error it catches there, once for each row a `listRow` fails in; an edition that wants that quieter gives its root an `onCaughtError` (`createRoot(el, { onCaughtError })`).
  - A handler for an event, or a listener for the stream coming back, that fails doesn't keep the event from the others. The failure is reported as an uncaught error, once for each handler, and not again while it keeps failing the same way.
  - An addition that waits shows nothing meanwhile (above).
- The content security policy is unchanged (`script-src 'self'`, `connect-src 'self'`). It blocks requests from the page to other origins, so call your own route and let the route call the service. **This is not containment**: an addition is your code, and can still send the page, or a new window, to another address.
- Don't listen for `message` events: the preview's frame is another origin and can post to the app.
- Everything in the web app that is not exported from `@galley/web/app`, `@galley/web/additions` and `@galley/web/ui` may change at any time.

## Getting the code

`@galley/server` and `@galley/web` are not published as packages. Put the Galley repository inside your own workspace, **pinned to a commit**, and build from source. That has costs you should know:

- Your lockfile, not Galley's, decides the versions of its dependencies. Before it starts with extensions, the server checks four things about how the router it was given reads an address (the four the guards above rest on) and refuses to start if one is different. That is not every way a router can differ: keep `hono` and `@hono/node-server` at the versions the release you pinned was built with.
- Building from source runs Galley's development tools in your build.
- Security fixes reach you when you move your pin. Watch the repository's releases and security advisories; only the latest minor version gets fixes, and taking one may mean taking a change to the shapes on this page.
- What [the security model](/docs/running/security/) says about the container image is about Galley's own image, not yours.

For the app, three things more:

- **Start your page from the app's own**, `packages/web/index.html`, and change only the entry file it loads. The attributes on its `<html>` and `<body>` (`data-surfaces="app"`, `data-theme`, `class="g-root"`) are what the app's base styles and surfaces hang on, and `/theme.js` paints the saved theme before the page loads. A bare `<div id="root">` gives an app without its fonts, colours or box sizing.
- Add the preset to your Vite config, beside the React plugin: `import { galleyWeb } from "@galley/web/vite"`, then `plugins: [react(), galleyWeb()]`. It sets:
  - the two aliases the app's source is written with, `@` and `@brand`. Your own source can't use either name for something else.
  - one copy of `react`, `react-dom`, `react-router` and `react-router-dom` in the page, whatever versions sit beside the app's. With two copies a hook called from your addition (a `useNavigate` from your own `react-router`, say) throws. Keep your versions at the app's all the same.
  - the app's public folder (it holds `theme.js`, which the server serves from what you build) and the app's build target (`es2023`), unless your config names its own. **If you have a public folder of your own, name it in your config (`publicDir`) and copy `packages/web/public/theme.js` into it** — otherwise the preset's folder is used in its place and your own files are left out of the build.
- Don't set `resolve.preserveSymlinks`: the app's modules would be loaded twice, and there would be two streams.
- TypeScript checks the app's source together with yours, by your rules. Your `tsconfig.json` needs the same two `paths` (`@/*` to the web package's `src/*`, `@brand/*` to the repository's `brand/*`), `"jsx": "react-jsx"` and the `vite/client` types; extending the repository's `tsconfig.base.json` keeps the rest in step.
- Import `@galley/web/styles` once, in your entry file. Serve what you build as the server's `webDir`.
