# Form capture: the inbox

When a form's destination is **the inbox** (provider `galley`), visitors'
browsers send each submission to the Galley server. The server checks it,
stores it, tells the people you chose, forwards it where only a server can,
and shows it in the app's **Inbox** — live, with search, Spam, export, and
delete.

This page is for site owners and the people who run Galley. The last two
sections are for developers.

---

## How a submission travels

1. A visitor sends the form. The site's own script (`@galley/astro`) posts the
   answers as JSON to the site's **capture address**:
   `<server address>/f/<siteId>`. Without JavaScript, the browser posts the
   same form as a plain form post and is sent back to the page afterwards.
2. The server checks, in this order: is the site open on this server; did the
   request come from one of the site's own addresses; is this visitor (or this
   form) sending too much; does the form exist and send to the inbox; are the
   answers right for this form; does it look like spam.
3. The submission is stored. The visitor's browser gets an answer straight
   away.
4. Then, in the background, without delaying that answer: the open app shows
   it (the Inbox badge updates and the row slides in), the e-mail alert goes
   out, and server-side destinations (webhooks) are sent, with retries.

### Which version of the form counts

A live page was built from the **published** form, so submissions from
visitors are checked against the published version — an unpublished edit
that adds a required field can't break the live form. Submissions from a
preview on this computer, or from the app's "Send a test submission", are
checked against the version you are editing, and are kept marked **Test**
(the live site never posts from those addresses). A form that has never been
published is read from your working copy either way.

---

## What is stored — and what isn't

Submissions live in the Galley home folder, never in the site's files, so
nothing a visitor writes is ever published:

```
<home>/state/<siteId>/submissions/<formId>.jsonl     one submission per line, oldest first
<home>/state/<siteId>/capture.json                   capture settings
<home>/state/<siteId>/capture.secrets.json           Turnstile secret, forwarding secrets
```

The folder is readable by the server's user only (0700, files 0600).
`<home>` is `GALLEY_HOME` (default `~/.galley`).

Each line holds: an id that sorts by time, the form, the time it arrived, the
answers (only for fields the form has and is showing — anything else is
dropped), the page it was sent from, how it was forwarded, and the read / spam
marks.

**Deliberately not stored:**

- **The visitor's IP address.** It is used only for the per-visitor rate
  limit, hashed, in memory, for at most a minute — never written down, never
  logged, never sent anywhere (not even to Cloudflare's Turnstile check, where
  it is optional).
- **Query strings**, other than campaign parameters. The page address and the
  referrer keep only `utm_*` parameters; anything else (an e-mail address, a
  session id, a one-time token) is cut off, and so is the `#fragment`.
- Cookies, the browser's user agent, and anything the form doesn't ask for.

---

## Who can send

Browsers always say which site a page is on (the `Origin` header). The
capture address accepts a post only from:

- the site's **live and staging addresses** (Site settings), and each one's
  `www.` twin — `https://example.com` also lets in `https://www.example.com`;
- **other addresses** you list in Inbox › Capture settings, one per line
  (a landing-page domain, a second site);
- **previews**: on a computer of your own, any address on this computer
  (`localhost`, `127.0.0.1`); on a hosted server, the server's own host name on
  any port;
- the app itself (for "Send a test submission").

Anything else gets `403` with no explanation. The answer to a browser names
exactly the page's own origin — never `*`, never with cookies.

### Sending from another server: the capture key

A program on a server sends no `Origin`. Such requests are refused unless the
site has a **capture key**: Inbox › Capture settings › Sending from another
server › Turn on with a key. The key is shown **once**; only a hash of it is
kept. Send it as a header:

```sh
curl -X POST https://cms.example.com/f/<siteId> \
  -H "content-type: application/json" \
  -H "x-capture-key: ck_…" \
  -d '{"form":"contact","values":{"name":"Ada","email":"ada@example.com"}}'
```

"Make a new key" replaces the old one immediately; "Turn off" removes it.

---

## Spam protection

Spam is **kept, flagged, and hidden** in the Spam view, and the sender is
answered exactly as if it had worked — a bot learns nothing about which check
caught it, and a real person wrongly caught can be rescued with "Not spam".
Nothing flagged as spam is e-mailed or forwarded.

| Check | What it does |
| --- | --- |
| Hidden field | A field people can't see; bots fill it in. On unless the form turns it off (`spam.honeypot: false`). |
| Minimum time | `spam.minSeconds` in the form: sent faster than that is spam. Without JavaScript the time can't be measured, so those posts land in Spam (recoverable). |
| Cloudflare Turnstile | When the form has a Turnstile site key (`spam.turnstileSiteKey`) **and** the site's Turnstile secret key is set in Capture settings, each submission's token is checked with Cloudflare's `siteverify`. A failed or missing token is spam. Without the secret nothing is checked (the settings say so). A test from the app can't pass the check, so it lands in Spam. |
| Repeats | The same answers to the same form within a minute (a double click) are answered with the first one's id and stored once. |
| Rate limits | **Refused out loud**: `429` with `Retry-After`. Defaults: 5 per minute per visitor address per site, 60 per minute per form; both are in Capture settings. |
| Size | A submission is at most 64 KB. |

Behind a reverse proxy, set `GALLEY_TRUST_PROXY=1` so the per-visitor limit
sees visitors' addresses rather than the proxy's.

---

## E-mail alerts

Per form, a list of addresses (Capture settings › E-mail alerts) is told
about each new submission (spam excluded): the form's name, the answers as a
table in the form's order, the page and campaign, and a link straight to it in
the inbox. Replying to the e-mail replies to the visitor when the form has an
e-mail field.

The server needs an SMTP server to send through. Whoever runs Galley sets:

```sh
GALLEY_SMTP_URL=smtps://user:password@smtp.example.com:465   # or smtp://…:587 (STARTTLS)
GALLEY_MAIL_FROM="Website <forms@example.com>"
```

Without both, nothing is sent and Capture settings says so ("No mail
settings"); each submission records that no e-mail went out, and "Retry" sends
it once mail is set up. Delivery uses [Nodemailer](https://nodemailer.com).

---

## Forwarding (server-side destinations)

Some destinations must not run in the visitor's browser because they need a
secret. Mark a destination **server-side** in the form and the site's script
leaves it out of the page; the server sends it after storing the submission:

```json
{
  "provider": "webhook",
  "settings": {
    "serverSide": true,
    "url": "https://hooks.example.com/forms/{{secret:hook-path}}",
    "format": "json",
    "headers": { "Authorization": "Bearer {{secret:hook-token}}" }
  },
  "mapping": { "email": "Email" },
  "constants": { "lead_source": "Website" }
}
```

- `{{secret:name}}` is replaced with a **forwarding secret** stored in the app
  (Capture settings › Forwarding secrets), so the secret is in neither the page
  nor the site's files.
- `format: "json"` (default) sends
  `{ form, formName, id, at, page, values }` with `values` under the
  destination's field names (mapping applied, fixed values added);
  `format: "form"` sends them urlencoded.
- Three tries (after 2 s and 10 s) on network errors, `408`, `425`, `429` and
  `5xx`; no retry for other answers. Each result is recorded on the
  submission and shown under **Sent on** with **Retry** / **Send again**.
- A server-side destination is sent only if the form also sends to the inbox
  (that is how the submission reaches the server), and only when its "only
  when…" rule holds.
- On a hosted server, forwarding goes only to `https://` addresses that
  resolve to public IP addresses. On a computer of your own it may also go to
  `http://` and to this computer (for a local test catcher).

---

## Reading, exporting, deleting

- **Inbox** (sidebar; the badge is the unread count): forms on the left, the
  form's submissions in the middle (newest first; name and e-mail first in each
  row), the submission in full on the right — every answer with its label in
  the form's order, the page, how the visitor arrived (`utm_*`), and what was
  sent on. Opening one marks it read.
- **Search** looks through every answer and the page address. **Spam** shows
  what the checks caught. Select several to mark them read, move them to or
  from Spam, or delete them.
- **Export** downloads the current view as a CSV file: UTF-8 with a byte-order
  mark (so Excel shows accents correctly), the form's fields as columns in the
  form's order with their labels as headers, then the time, the page, the
  referrer and the spam mark. Cells that would start a spreadsheet formula
  (`= + - @`) are prefixed with `'`.

### Retention and deletion (a person's right to be forgotten)

Submissions are kept until you delete them; there is no automatic expiry.

To remove one person's data: open Inbox, choose the form, **search** for their
name or e-mail address, select every match (check Spam too), and **Delete**.
Deleting rewrites the file without those lines straight away — the data is
gone from disk, not hidden. The toast's **Undo** works only while the app
keeps the deleted copy in memory for that toast. Copies made before — exported
CSV files, e-mail alerts, forwarded webhooks, backups of the Galley home
folder — are outside the app and must be cleaned up where they live.

---

## Running it where visitors can reach it

A static site's visitors can only send to a server that is **on the
internet**. The app says so wherever the inbox is offered:

- **Hosted** (`galley serve`, or the container, with `GALLEY_PUBLIC_URL` set
  to a public `https://` address): the capture address is
  `https://cms.example.com/f/<siteId>` and visitors reach it. Put that address
  in the site's integration options (`forms.endpoint`) or the destination's
  `endpoint` setting, and publish.
- **On a computer of your own** (desktop app, `npx galley`): the capture
  address is `http://127.0.0.1:<port>/f/<siteId>`. Real visitors can't reach
  it. It works for testing — from a preview, or with **Send a test
  submission**.

### Without Galley on a server

A site whose Galley runs only on a laptop can still take submissions — just
not into this inbox. Send the form to:

- your **CRM** (HubSpot, Marketo, Salesforce, Pardot destinations);
- a **webhook** in the browser (an automation tool, a serverless function, a
  form backend service);
- the visitor's **e-mail program** (`mailto`, a last resort: nothing is
  stored).

---

## For developers: the capture endpoint

`POST <server>/f/:siteId` — outside the app's session and CSRF guards, behind
the Host check, with its own rules above. `OPTIONS` answers the CORS
preflight.

**Request** (`Content-Type: application/json`, at most 64 KB):

```json
{
  "form": "contact",
  "values": { "name": "Ada", "email": "ada@example.com", "areas": ["a", "b"] },
  "page": { "url": "https://example.com/contact/?utm_source=news", "title": "Contact", "referrer": "https://…" },
  "meta": { "honeypot": "", "elapsedMs": 8400, "turnstileToken": "…", "test": false }
}
```

`values` are keyed by field id: a string, or a list of strings for
`checkboxes`. A ticked box is any value but `""`, `false`, `no`, `off` or `0`
(the site sends `"true"`) and is stored as `"yes"`. Other `meta` keys are
ignored.

**Without JavaScript** (`application/x-www-form-urlencoded`): `_galley_form`
(the form id), `_galley_return` (the page to go back to), `_galley_hp` (the
hidden field) and the inputs under their own names (the galley destination's
mapping, else the field's `name`, else its id). Answered with `303` to
`_galley_return` — only when it is on the posting page's own origin — or a
small HTML page (sent, or the problems by label with a link back).

**Answers** (JSON; CORS headers name the page's origin and expose `Retry-After`):

| Status | Body | When |
| --- | --- | --- |
| `200` | `{ "ok": true, "id": "01M840CS7HZAWF004EV578" }` | Stored (or flagged as spam, or a repeat of the last minute) |
| `422` | `{ "ok": false, "errors": { "email": "Enter an e-mail address, like name@example.com." }, "message"?: "<form's errorMessage>" }` | Answers refused |
| `429` | `{ "ok": false, "message": "Too many submissions in a short time. Wait 41 seconds and send it again." }` + `Retry-After` | Rate limit |
| `403` | `{ "ok": false }` | Origin not allowed, or no Origin and no valid `X-Capture-Key` |
| `404` | `{ "ok": false, "message": "…" }` | Site not open here, form unknown, or the form doesn't send to the inbox |
| `400` / `413` / `415` | `{ "ok": false, "message": "…" }` | Unreadable JSON / over 64 KB / another content type |

Field messages are the ones the site's script and the form builder's Test
use, so a visitor never sees two wordings for one mistake.

### The app's API

All behind the session, typed in `ApiRoutes` (`packages/core/src/api.ts`):

| Route | |
| --- | --- |
| `GET /api/sites/:siteId/inbox` | forms with `total`, `unread`, `spam`, `latestAt`, `capturing`; overall `unread` |
| `GET /api/sites/:siteId/inbox/:formId?filter&q&offset&limit` | submissions, newest first (`filter`: inbox, unread, spam, all) |
| `GET /api/sites/:siteId/inbox/:formId/:submissionId` | one submission |
| `PATCH /api/sites/:siteId/inbox/:formId` | `{ ids, read?, spam? }` |
| `POST /api/sites/:siteId/inbox/:formId/delete` / `…/restore` | delete for good (returns what went) / Undo |
| `POST /api/sites/:siteId/inbox/:formId/:submissionId/retry` | `{ destination: <index> \| "email" }` |
| `GET /api/sites/:siteId/inbox/:formId/export?filter` | the CSV file |
| `GET` / `PATCH /api/sites/:siteId/capture` | capture settings, incl. `captureAddress` and `captureReachable` |
| `POST /api/sites/:siteId/capture/key` | `{ action: "rotate" \| "remove" }` → the new key, once |
| `POST /api/sites/:siteId/forms/introspect` | read a HubSpot or Marketo form's public field list |

The live event is `{ type: "forms.submission", siteId, form, change: "added" | "updated" | "deleted", ids, submission? }`
on `GET /api/events`.

### Reading a provider's existing form

`forms/introspect` reads only what the provider publishes without
credentials — the definition its own embed script loads:

- **HubSpot**: `https://forms.hsforms.com/embed/v3/form/<portalId>/<formId>/json`
  (`forms-<region>.hsforms.com` for other data regions). Forms made in
  HubSpot's newer form editor aren't served there; the app says so.
- **Marketo**: `<host>/index.php/form/getForm?munchkinId=<id>&form=<formId>`,
  the form descriptor `forms2.js` loads.

Guards against server-side request forgery: `https://` only, default port,
no user name in the address; HubSpot only to its own `hsforms.com` hosts;
the Marketo host is resolved first and refused if any address is private,
loopback, link-local or otherwise not public, and the connection is made to
exactly the address that was checked; redirects only to the same host, at
most two; 8-second timeout; 1 MB cap.

### The forwarder interface

Server-side destinations other than `webhook` are added by registering a
forwarder for their provider id (exported from `@galley/core/forms`):

```ts
import type { FormForwarder } from "@galley/core/forms";

export const crmForwarder: FormForwarder = {
  id: "my-crm",
  async send(submission, destination, ctx) {
    // ctx.payload: answers under the destination's field names, fixed values added
    // ctx.secret(name): a forwarding secret from Capture settings, or null
    // ctx.fetch(url, init, ctx.guard): outbound HTTP with the SSRF guards for this server's mode
    const token = ctx.secret("my-crm-token");
    if (!token) return { ok: false, detail: "Add the “my-crm-token” forwarding secret.", retry: false };
    const response = await ctx.fetch("https://api.my-crm.example/leads", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(ctx.payload),
    }, ctx.guard);
    return response.status < 300 ? { ok: true } : { ok: false, detail: `The CRM answered ${response.status}.`, retry: response.status >= 500 };
  },
};

// services.forms.forwarders.register(crmForwarder)  → returns an unregister function
```

`send` should not throw (a throw counts as a failed try). Return
`retry: false` when trying again can't help. Results are recorded as
`delivery[]` entries `{ provider, destination, ok, detail, attempts, at }`.
