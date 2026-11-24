# Plugins

A plugin adds something to Galley without changing Galley: a framework
adapter, an image or video generator, a form destination, a third-party
script, an importer, a deploy host, a place to host the editor itself, a
tool for the assistant (and for any harness over MCP), or a hook that runs
when something is published. Every built-in is registered the same way —
the framework adapters, the image providers, the form and script catalogue,
the Cloudflare and Vercel hosts, the editor's hosts and the OpenRouter plugin
all go through the one public API described here. If a built-in ever needs a
door this API doesn't have, the API is what gets fixed.

- [What a plugin can and cannot do](#what-a-plugin-can-and-cannot-do)
- [A complete plugin in one file](#a-complete-plugin-in-one-file)
- [The shape](#the-shape)
- [Contributions](#contributions)
  - [Data sources](#data-sources)
- [Settings and secrets](#settings-and-secrets)
- [Hooks and their guarantees](#hooks-and-their-guarantees)
- [Installing, enabling, and plugins a site names](#installing-enabling-and-plugins-a-site-names)
- [Testing with the kit](#testing-with-the-kit)
- [Naming and publishing](#naming-and-publishing)
- [How first-party plugins are built](#how-first-party-plugins-are-built)

## What a plugin can and cannot do

A plugin **can** add contributions of the kinds listed below, ask for
settings (secrets included), log, call out to the network with the `fetch`
it is given, read a site through the same `SiteService` facade the server and
the assistant use, and refuse a publish.

A plugin **cannot** shadow a built-in assistant tool, read another plugin's
settings, receive the app's own keys (the Anthropic, OpenAI and Google keys,
or anything in a `GALLEY_*` variable), write to a site from a hook, or write
from a tool that declared itself read-only. A tool's writes are always made
in the mode of the call — content mode cannot be upgraded to build mode by
asking — and `SiteService` enforces the mode again underneath.

What a plugin is **not**: a sandbox. A plugin is code running inside the
Galley process with the same permissions as the person who started it. The
rules above stop accidents and keep the API honest; they do not contain a
plugin written to do harm. Install only plugins you trust, exactly as you
would any npm package.

## A complete plugin in one file

No dependencies, no build step — a plain object as the default export:

<!-- include: packages/plugin-kit/test/samples/minimal-plugin.mjs#minimal -->
```js
// galley-plugin-hello — the smallest useful plugin: one file, no dependencies, no build step.
export default {
  name: "galley-plugin-hello",
  version: "1.0.0",
  apiVersion: 1,
  tools: [
    {
      name: "say_hello",
      title: "Say hello",
      description: "Greet someone by name. Read-only; use it when the person asks the assistant to say hello.",
      input: { type: "object", properties: { name: { type: "string", description: "Who to greet." } }, required: ["name"] },
      mode: "content",
      effect: { readOnly: true },
      run: (input) => `Hello, ${input.name}.`,
    },
  ],
};
```

Save it as `tools/plugin.mjs` in a site and name it in the site's
`galley.config.json`:

<!-- sample: config -->
```json
{
  "plugins": ["./tools/plugin.mjs"]
}
```

or package it and install it for everyone on this computer with
`galley plugin add` ([below](#installing-enabling-and-plugins-a-site-names)).
The assistant now offers `say_hello`, and so does every MCP harness connected
to the site.

## The shape

<!-- include: packages/core/src/plugins/types.ts#plugin-interface -->
```ts
export interface GalleyPlugin {
  /** npm-style: "galley-plugin-foo" or "@scope/galley-plugin-foo". */
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  /** The plugin API version this plugin was written for: 1. */
  apiVersion: 1;
  /** What it contributes — every key optional. */
  adapters?: GalleyAdapter[];
  imageProviders?: ImageProviderPlugin[];
  videoProviders?: VideoProviderPlugin[];
  formProviders?: FormProviderContribution[];
  scriptIntegrations?: ScriptIntegrationContribution[];
  importers?: ImporterContribution[];
  deployTargets?: DeployTargetContribution[];
  /** Places the editor itself can be hosted online. */
  editorHosts?: EditorHostContribution[];
  tools?: SiteToolContribution[];
  /** Where a field's values can be picked from (a product, a collection). */
  dataSources?: DataSourceContribution[];
  hooks?: PluginHooks;
  /** Settings the plugin needs (shown in the app; secrets are never returned). */
  settings?: PluginSettingField[];
  /** Runs once when the plugin is enabled; may return a disposer that runs when it stops. */
  setup?(ctx: PluginContext): MaybePromise<void | (() => MaybePromise<void>)>;
}
```

Every key but `name` and `apiVersion` is optional. In TypeScript, wrap the
object in `definePlugin(…)` from `@galley/plugin-kit` to have it checked; at
run time `definePlugin` returns its argument unchanged, so a plugin that
doesn't use the kit's other helpers needs no dependency at all. Or write
`{ … } satisfies GalleyPlugin` with an `import type`, as the example plugin
does: the check is the same and the built plugin imports nothing.

Every call into a plugin gets a context — its own settings, a logger, `fetch`
and the product's brand constants. Hooks and tools also get the site.

<!-- include: packages/core/src/plugins/types.ts#context-interface -->
```ts
/**
 * What every plugin call receives: its own settings (secrets resolved for
 * this plugin alone), a logger that scrubs secrets, `fetch`, and the brand.
 * Nothing else of the engine — no filesystem paths, no other plugin's settings.
 */
export interface PluginContext {
  readonly plugin: { readonly name: string; readonly version: string | null };
  /** This plugin's settings by key, read fresh for each call. Missing values are undefined. */
  readonly settings: Readonly<Record<string, string | undefined>>;
  readonly log: PluginLogger;
  readonly fetch: typeof fetch;
  readonly brand: PluginBrand;
}
```

Name the product by `ctx.brand.productName`, never by hard-coding "Galley":
a deployment may rename it.

## Contributions

When two plugins offer the same thing — an image provider id, a script kind,
a tool name — the one used is the site's own plugin over an installed one
over a built-in, and within one layer the one registered first. Every
conflict is listed by `GET /api/plugins` and `galley plugin list`. Two
exceptions keep the built-ins trustworthy: a plugin's tool can't take a
built-in tool's name (the plugin is refused), and a plugin can't replace the
built-in deploy hosts or editor hosts.

### Framework adapters

`adapters` takes the same `GalleyAdapter` objects described in
[docs/adapters.md](adapters.md); the adapter kit's conformance checks run on
them through `checkPlugin` when you pass a fixture (see
[Testing](#testing-with-the-kit)). The `adapters` key of `galley.config.json`
still works: each adapter listed there is treated as a plugin contributing
one adapter.

### Image providers

<!-- include: packages/core/src/plugins/types.ts#image-provider-interface -->
```ts
/** An image generator. Selectable in Settings like the built-in ones. */
export interface ImageProviderPlugin {
  /** Lowercase letters, digits and dashes: "openrouter". Unique across providers. */
  id: string;
  label: string;
  /** The key of the secret setting (in the plugin's `settings`) that holds the API key. Leave out when none is needed. */
  keySetting?: string;
  /** The models to offer. May fetch (cache it): called whenever the app lists providers. */
  models(ctx: ProviderCallContext): MaybePromise<ImageModelInfo[]>;
  defaultModel: string;
  supportsReferences?: boolean;
  supportsTransparency?: boolean;
  generate(request: ImageGenerationRequest, ctx: ProviderCallContext): Promise<GeneratedImageResult[]>;
}
```

A provider for a made-up service:

<!-- include: packages/plugin-kit/test/samples/image-provider.mjs#image-provider -->
```js
import { ProviderError } from "@galley/plugin-kit";

// An image provider for a made-up service, "Pictures". Selectable in Settings like the built-in ones.
export default {
  name: "galley-plugin-pictures",
  apiVersion: 1,
  settings: [{ key: "apiKey", label: "Pictures API key", secret: true, required: true, env: ["PICTURES_API_KEY"] }],
  imageProviders: [
    {
      id: "pictures",
      label: "Pictures",
      keySetting: "apiKey",
      defaultModel: "pictures-1",
      supportsReferences: false,
      models: () => [{ id: "pictures-1", label: "Pictures 1", price: "$0.02 per image" }],
      async generate(request, ctx) {
        let response;

        try {
          response = await ctx.fetch("https://api.pictures.example/v1/images", {
            method: "POST",
            headers: { authorization: `Bearer ${ctx.key}`, "content-type": "application/json" },
            body: JSON.stringify({ model: request.model, prompt: request.prompt, aspect: request.aspect, n: request.count }),
            signal: ctx.signal,
          });
        } catch {
          throw new ProviderError("unavailable", "Couldn't reach Pictures. Check the internet connection, then try again.");
        }
        // Classify by status (and the service's error codes), never by the wording of its message.
        if (response.status === 401) throw new ProviderError("auth", "Pictures didn't accept the API key in Settings.", "status=401");
        if (response.status === 402) throw new ProviderError("quota", "The Pictures account is out of credit.", "status=402");
        if (response.status === 429) throw new ProviderError("rate", "Pictures is limiting requests. Wait a minute, then try again.", "status=429");
        if (!response.ok) throw new ProviderError("unavailable", "Pictures had a problem. Try again in a minute.", `status=${response.status}`);
        const body = await response.json();

        return body.images.map((image) => ({ data: new Uint8Array(Buffer.from(image.base64, "base64")), mime: "image/png", cost: image.cost }));
      },
    },
  ],
};
```

Throw `ProviderError(kind, plain, detail)`: `plain` is the sentence the
person reads, `kind` decides how the app treats it (an `auth` or `quota`
problem points to Settings). Keep the key out of `detail` — the engine scrubs
again, but the kit's checks fail a provider that leaks it. Report `cost` when
the service tells you what a picture cost; the engine records it in usage.
The engine refuses to let anyone choose a provider in Settings before its key
is there, and refuses reference pictures or transparency where the chosen
model's `ImageModelInfo` says no. The OpenRouter plugin
(`packages/plugins/openrouter/src/images.ts`) is the full worked example: a
live model catalogue with prices, a dated fallback list, and request shaping
per model.

### Video providers

<!-- include: packages/core/src/plugins/types.ts#video-provider-interface -->
```ts
/**
 * A video generator. Video is asynchronous everywhere: `start` submits and
 * returns the provider's job id, the engine calls `poll` with backoff until
 * it is done, then `download` each output.
 */
export interface VideoProviderPlugin {
  id: string;
  label: string;
  keySetting?: string;
  models(ctx: ProviderCallContext): MaybePromise<VideoModelInfo[]>;
  defaultModel: string;
  start(request: VideoGenerationRequest, ctx: ProviderCallContext): Promise<{ jobId: string }>;
  poll(jobId: string, ctx: ProviderCallContext): Promise<VideoJobState>;
  download(jobId: string, index: number, ctx: ProviderCallContext): Promise<{ data: Uint8Array; mime: string }>;
}
```

The engine's `VideoService` owns the job: it calls `start`, polls with
backoff (5 s, growing to 30 s, giving up after 20 minutes), downloads each
output, keeps it as a candidate for two hours and saves the one the person
picks into the site's media. The media library takes MP4 files up to 25 MB.
`packages/plugins/openrouter/src/videos.ts` is the worked example.

### Script integrations

The site's runtime writes the built-in kinds itself. A plugin's kind ships
its snippet as a template; `{{settingKey}}` stands for a setting's value, and
when the app adds the integration to a site it writes the filled-in snippet
into the entry's settings as `src` / `inline` — the keys the runtime's
`custom` kind already reads — using `resolveScriptSnippet`.

<!-- include: examples/plugin-example/src/index.ts#script -->
```ts
const fathom: ScriptIntegrationContribution = {
  kind: "fathom",
  name: "Fathom Analytics",
  description: "Privacy-first page analytics without cookies.",
  category: "analytics",
  defaultConsent: "necessary",
  defaultPlacement: "head",
  settings: [{ key: "siteId", label: "Site ID", placeholder: "ABCDEFGH", pattern: "^[A-Z0-9]{4,12}$", required: true }],
  docsUrl: "https://usefathom.com/docs/script/embed",
  // {{siteId}} is replaced by the setting's value when the app adds the script to a site.
  snippet: { src: "https://cdn.usefathom.com/script.js", attributes: { "data-site": "{{siteId}}", defer: "" } },
};
```

### Form destinations

The catalogue entry the form builder shows, plus — optionally — a forwarder
that sends submissions on from the app's own inbox, and `introspect`, which
reads the fields of an existing form on the provider's side.

<!-- include: packages/plugin-kit/test/samples/form-provider.mjs#form-provider -->
```js
// A form destination: the catalogue entry the form builder shows, a server-side
// forwarder for submissions the app's inbox relays, and field introspection.
export default {
  name: "galley-plugin-formcatcher",
  apiVersion: 1,
  formProviders: [
    {
      id: "formcatcher",
      name: "Formcatcher",
      description: "Sends submissions to a Formcatcher form.",
      settings: [{ key: "formId", label: "Form ID", placeholder: "f_123", pattern: "^f_[0-9]+$", required: true }],
      canImportFields: true,
      async forward(_submission, destination, ctx) {
        const response = await ctx.fetch(`https://api.formcatcher.example/forms/${destination.settings.formId}/entries`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ctx.payload),
        });

        // A 4xx won't get better by trying again; anything else may.
        return response.ok ? { ok: true } : { ok: false, detail: `Formcatcher answered ${response.status}.`, retry: response.status >= 500 };
      },
      async introspect(settings, ctx) {
        const response = await ctx.fetch(`https://api.formcatcher.example/forms/${settings.formId}`);
        const form = await response.json();

        return form.fields.map((field) => ({ name: field.key, label: field.title, type: field.kind, required: field.required }));
      },
    },
  ],
};
```

### Importers

<!-- include: packages/plugin-kit/test/samples/importer.mjs#importer -->
```js
// "Bring content in from X": shown in the app's import list, and run by `galley import notes <folder>`.
export default {
  name: "galley-plugin-import-notes",
  apiVersion: 1,
  importers: [
    {
      id: "notes",
      name: "Plain notes",
      description: "Every .txt file in a folder, as a draft post.",
      input: "file",
      command: {
        help: "Usage: galley import notes <folder>\n\nTurn each .txt file in the folder into a draft post.",
        async run(argv, io) {
          if (argv.length !== 1) {
            io.err("Say which folder to read.");
            return 2;
          }
          io.out(`Would import the notes in ${argv[0]}.`);
          return 0;
        },
      },
    },
  ],
};
```

### Deploy hosts

`deployTargets` takes the deploy module's own `DeployTarget` objects
(`packages/core/src/deploy/types.ts`): connect with the host's key, check and
create a project, upload a built folder. The built-in Cloudflare and Vercel
targets are registered through this key by the built-in plugin. A plugin's
host is offered beside them; it can't replace them.

### Editor hosts

`editorHosts` takes the hosting module's own `EditorHost` objects
(`packages/core/src/hosting/types.ts`): the places "Host the editor online"
can put a hosted install of the app. A host inspects what its key may do,
plans everything it would create with a monthly cost (creating nothing),
creates exactly that — naming and tagging each thing and reporting it the
moment it exists — and later removes only what it created. Fly.io,
Cloudflare (in front of a computer of yours) and any server with Docker are
registered through this key by the built-in plugin; a plugin's host is
offered beside them and can't replace them.

### Assistant and MCP tools

A tool's input is a small JSON Schema (objects, strings, numbers, booleans,
enums and arrays of those). The engine turns it into the same validator its
own tools use, so the assistant and MCP describe and check it exactly like a
built-in. `mode: "build"` tools are offered only in build mode; the declared
`effect` becomes the MCP annotations harnesses use to decide when to ask the
person first — and `readOnly: true` is enforced.

<!-- include: examples/plugin-example/src/index.ts#tool -->
```ts
/** Words in a piece of text: runs of letters or digits, apostrophes and hyphens inside words included. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

const countWordsTool: SiteToolContribution = {
  name: "count_words",
  title: "Count the words on a page",
  description:
    "Count the words in one entry: its body and every text field. Use it when the person asks how long a page or post is, or whether it fits a word limit. Read-only.",
  input: {
    type: "object",
    properties: { path: { type: "string", description: "The entry's path, as list_entries or search_content gave it." } },
    required: ["path"],
  },
  mode: "content",
  effect: { readOnly: true },
  label: () => "Counting the words",
  async run(input, ctx) {
    const entry = await ctx.site.readEntry(String(input.path));
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };

    collect(entry.data);
    const body = countWords(entry.body ?? "");
    const fields = countWords(strings.join(" "));

    return { title: entry.title, words: body + fields, body, fields };
  },
};
```

A tool a person must opt into on purpose — one that changes another service
directly — names one of the plugin's own plain settings in `enabledBy`. It is
offered only while that setting is `on` (or `yes`, `true`, `1`), and refuses
to run when it isn't, whatever tool list a caller still holds. Switching it
changes the tool list, like turning a plugin on or off. Make that setting a
`"toggle"` with a `consequence` ([Settings and secrets](#settings-and-secrets)). The Shopify plugin's
`shopify_update_product_copy` is offered only while "Let the assistant edit
product copy on Shopify" is on.

### Data sources

Values a field can be picked from that live somewhere else — products in a
store, people in a directory. The content file keeps only the value, a plain
string (a product's handle), so the site stays files; the app shows a picker
that searches the source.

<!-- include: packages/core/src/plugins/types.ts#data-source-interface -->
```ts
/**
 * Values a field can be picked from, held somewhere else: products in a
 * store, people in a directory. The content file keeps only `value` (a plain
 * string), so the site stays files; the app shows a picker that searches
 * here. A field opts in with `"dataSource": "<id>"` in galley.config.json.
 */
export interface DataSourceContribution {
  /** Lowercase letters, digits and dashes: "shopify-products". */
  id: string;
  label: string;
  description?: string;
  /** Up to `ctx.limit` items matching what the person typed (empty: the first few). */
  search(query: string, ctx: DataSourceContext): MaybePromise<DataSourceItem[]>;
  /** The item a saved value stands for, or null when the source no longer has it. */
  get(value: string, ctx: DataSourceContext): MaybePromise<DataSourceItem | null>;
}
```

An item is `{ value, title, image?, detail? }`; the context is a site
context (the site read-only — a picker never changes it) plus `signal` and
`limit`. A field opts in by naming the source in `galley.config.json`, on
the field itself or on a list's items:

<!-- sample: config -->
```json
{
  "collections": [
    {
      "id": "pages",
      "fields": [
        {
          "key": "sections",
          "blocks": [
            { "type": "featured-product", "fields": [{ "key": "product", "dataSource": "shopify-products" }] },
            { "type": "product-rail", "fields": [{ "key": "products", "type": "list", "of": { "key": "item", "type": "string", "dataSource": "shopify-products" } }] }
          ]
        }
      ]
    }
  ]
}
```

The field's model carries `dataSource`, and the picker calls
`GET /api/sites/:siteId/data-sources/:sourceId?q=…` to search (up to
`limit`, default 12, at most 50) or `?value=…` to show what a saved value
stands for. It answers `{ source, items }` or `{ source, item }` (`item` is
`null` when the source no longer has it), with only those four fields of
each item, within 15 seconds. `GET /api/sites/:siteId/catalog` lists the
sources (`dataSources`).

In the entry form such a field is a picker: the saved value is shown with
its title, detail and picture (looked up with `?value=`; an `image` that is a
path from the site's root is read from the site's media folders, or else from
its running preview), typing searches
the source (up to 12 results, arrow keys and Enter to choose, Escape to keep
the current one), and choosing writes only the item's `value`. In a list each
item is picked on its own row. A value the source no longer has is said so
plainly on the field ("No longer in the shop") rather than shown as if it
were fine. When the plugin that offers the source is off, the field is an
ordinary text box showing the value, with a note saying why.

## Settings and secrets

`settings` lists what the plugin asks for; the app shows them on its Plugins
screen and `PUT /api/plugins/settings` saves them. A setting is a text box
unless its `type` says otherwise:

- `"toggle"` — an on/off switch, saved as `"on"` or `"off"` (`default` says
  which it is while nothing is saved; off unless said). Give it a
  `consequence`: one sentence on what switching it on does, shown beside the
  switch. A switch a tool's `enabledBy` names lets the assistant act outside
  the app, so the Plugins screen shows it as a decision — and the kit's
  check warns when such a switch has no `consequence`.
- `"select"` — one of `options` (`[{ value, label }]`), with an optional
  `default`; anything else is refused on save.

A secret is always typed. The plugin reads every setting as a string, and a
toggle or select nobody has set reads as its default. The Shopify plugin's
switch:

<!-- include: packages/plugins/shopify/src/index.ts#switch -->
```ts
{
  key: "allowProductEdits",
  type: "toggle",
  label: "Let the assistant edit product copy on Shopify",
  consequence: "Product titles, descriptions, search texts and picture descriptions the assistant changes go live in the store at once — they don't wait in Proof.",
  help: "It shows you the new text and asks before each change. Prices, stock and status are never touched. Needs the Admin API token (or client ID and secret) above.",
},
```
 Plain values are kept in
`<home>/plugin-settings.json`; a `secret: true` value goes to the same secret
store as the app's own keys (`<home>/secrets.json`, readable only by you), is
never returned by any route — only whether it is set and its last four
characters — and is cut out of everything the plugin logs. An `env` list
names environment variables that supply the value instead; the environment
always wins and the app can't change it. Values are checked against
`pattern` when saved.

A plugin's secrets are stored under its own name, so no plugin reads
another's. Built-in plugins alone may give a secret a shared name; the
OpenRouter plugin keeps its key as `openrouter`, with `OPENROUTER_API_KEY`
taking precedence:

<!-- include: packages/plugins/openrouter/src/index.ts#settings -->
```ts
const settings = [
  {
    key: "apiKey",
    label: "OpenRouter API key",
    help: "Create one at openrouter.ai › Keys. Images and videos are paid from that account's credit.",
    secret: true,
    required: true,
    pattern: "^sk-or-[A-Za-z0-9_-]{16,}$",
    placeholder: "sk-or-v1-…",
    // The one name this key has everywhere in the app; the environment wins over what is saved.
    secretName: "openrouter",
    env: ["OPENROUTER_API_KEY"],
  },
];
```

## Hooks and their guarantees

<!-- include: packages/core/src/plugins/types.ts#hooks-interface -->
```ts
/**
 * Lifecycle hooks. Each may be async. Hooks of every enabled plugin run one
 * after another (built-in plugins first, then installed, then the site's).
 * A hook that throws or takes too long is reported and never breaks the
 * action — except that a `beforePublish` returning `{ refuse }` stops the
 * publish with that message. `{ warnings }` are shown, never a stop.
 */
export interface PluginHooks {
  beforePublish?(ctx: SitePluginContext, changes: ChangeSet): MaybePromise<void | BeforePublishResult>;
  afterPublish?(ctx: SitePluginContext, result: PublishResult): MaybePromise<void>;
  afterDeploy?(ctx: SitePluginContext, deployment: DeploymentInfo): MaybePromise<void>;
  onSubmission?(ctx: SitePluginContext, submission: FormSubmission): MaybePromise<void>;
}
```

- Hooks of every enabled plugin run one after another: built-in plugins
  first, then installed ones, then the site's own, each in the order they
  were registered.
- `beforePublish` runs before anything is committed and receives the changes
  that would be published. Returning `{ refuse: "…" }` stops the publish; the
  person reads “*Plugin name* stopped this publish: …” and nothing changes.
  Returning `{ warnings: ["…"] }` lets it go ahead, but the person reads each
  warning first, under the plugin's name: in Proof (with the other problems)
  and in the Publish dialog (“You can still publish”). Write each as one
  plain sentence saying what is wrong and where. Proof asks ahead —
  `POST /api/sites/:siteId/publish/check` runs the checks on the pending
  changes without publishing — so a `beforePublish` must only read; the
  publish result carries the warnings too (`warnings`).
  A `beforePublish` that throws or takes longer than 30 seconds is reported
  and the publish goes ahead — only a refusal stops it.
- `afterPublish`, `afterDeploy` and `onSubmission` run after the fact, in the
  background, one after another, each with a 60-second limit. A failure is
  logged against the plugin (secrets cut out) and changes nothing that
  already happened.
- Hooks get the site read-only: a hook that published or discarded from
  inside a publish would loop.

<!-- include: examples/plugin-example/src/index.ts#hook -->
```ts
/** One plain sentence about a publish, for a chat channel. */
export function publishSummary(siteName: string, result: PublishResult): string {
  const files = result.files.length;
  const what = `${files} ${files === 1 ? "file" : "files"}`;

  if (result.pullRequestUrl) return `${siteName}: ${what} sent for review — ${result.pullRequestUrl}`;
  return `${siteName}: ${what} published${result.pushed ? "" : " (saved on this computer; not sent to the live site yet)"}.`;
}

async function afterPublish(ctx: SitePluginContext, result: PublishResult): Promise<void> {
  const url = ctx.settings.webhookUrl;

  if (!url) return;
  const site = await ctx.site.summary();
  const response = await ctx.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: publishSummary(site.name, result) }),
  });

  // Throwing is fine: the engine reports it on the Plugins screen and the publish stands.
  if (!response.ok) throw new Error(`the webhook answered ${response.status}`);
  ctx.log.info(`told the webhook about the publish of ${site.name}`);
}
```

A publish gate:

<!-- include: packages/plugin-kit/test/samples/before-publish.mjs#before-publish -->
```js
// A publish gate: refuses a publish while a page still says "Lorem ipsum".
export default {
  name: "galley-plugin-no-lorem",
  apiVersion: 1,
  hooks: {
    async beforePublish(ctx, changes) {
      for (const file of changes.files) {
        if (file.kind !== "content" || file.status === "deleted") continue;
        const { content } = await ctx.site.readFile(file.path);

        if (/lorem ipsum/i.test(content)) return { refuse: `“${file.title ?? file.path}” still has placeholder text (Lorem ipsum).` };
      }
    },
  },
};
```

## Installing, enabling, and plugins a site names

Plugins come from three places.

**Built in.** Everything Galley ships, registered at start-up. The core
built-ins can't be turned off; the first-party plugins that ship with the
app (OpenRouter, and the WordPress importer when its package is present) can.

**Installed for this computer or server**, with the CLI:

<!-- command -->
```sh
galley plugin add galley-plugin-example     # from npm
galley plugin add ./galley-plugin-example   # from a folder
galley plugin add ./galley-plugin-example-1.0.0.tgz
galley plugin list
galley plugin disable galley-plugin-example
galley plugin enable galley-plugin-example
galley plugin remove galley-plugin-example
```

Installed plugins live in `<home>/plugins` (`~/.galley/plugins`, or under
`GALLEY_HOME`) — a small npm project of their own. npm runs with
`--ignore-scripts`, so installing never runs a package's own install
scripts; the exact version that arrived is kept in
`<home>/plugins/installed.json`. A package is accepted only if its
`package.json` has the keyword `galley-plugin` (or a `galley` field) and it
exports a plugin that passes the structural check; otherwise it is removed
again with the reason. Enabled plugins load when the app starts — restart a
running app to pick up a change. A plugin that throws while loading or
starting is turned off for the session with a plain note on the Plugins
screen; it never stops the server. `GALLEY_DISABLE_USER_PLUGINS=1` skips
installed plugins entirely.

**Named by a site**, in its `galley.config.json`, as package names (from the
site's own `node_modules`) or paths to files inside the site — the same rules
as site adapters:

<!-- sample: config -->
```json
{
  "plugins": ["galley-plugin-example", "./tools/plugin.mjs"]
}
```

This runs the site repository's own code inside Galley — the same trust the
site already gets when its dev server starts. Only what the config names is
loaded, only from inside the site folder or its `node_modules`, and only for
that site. `GALLEY_DISABLE_SITE_PLUGINS=1` turns site plugins off (and site
adapters with them; `GALLEY_DISABLE_SITE_ADAPTERS=1` still turns off adapters
alone). On a hosted server — `galley serve`, behind a password — they are off
unless the operator sets `GALLEY_ALLOW_SITE_PLUGINS=1`, because anyone who can
open a site there would otherwise run code on the server. A site's image and
video providers are not used (they are server-wide choices); install the
plugin instead.

Over HTTP (authenticated, like every route): `GET /api/plugins` and
`GET /api/sites/:siteId/plugins` list plugins with what each adds, its
problems, its recent log and its settings; `POST /api/plugins/enabled` turns
one on or off; `PUT /api/plugins/settings` saves settings; `GET /api/catalog`
and `GET /api/sites/:siteId/catalog` serve the merged catalogues (form
destinations, script integrations, image and video providers, importers,
deploy hosts) the app chooses from.

## Testing with the kit

`@galley/plugin-kit` has the types, `definePlugin`, `ProviderError`,
`resolveScriptSnippet`, test doubles (`fakeFetch`, `testContext`,
`providerContext`) and `checkPlugin` — the checks that say whether a plugin
is correct. The structural check is the one the engine runs before using a
plugin; the rest exercise each contribution the way the engine will: an
adapter through the adapter kit's conformance check (pass `adapters: { id:
{ fixture } }`), an image or video provider against a fake `fetch` (a refused
key must become a plain `auth` error without the key in it; no network must
become a plain error; your own scripted reply must come back as pictures), a
tool's input through the engine's validator, a script snippet through the
resolver. With vitest, `describePlugin` from `@galley/plugin-kit/vitest` runs
them as a test:

<!-- include: examples/plugin-example/test/plugin.test.ts#checks -->
```ts
// The kit's checks: the shape the engine requires, and each contribution exercised the way the engine uses it.
describePlugin(examplePlugin);
```

…and the plugin's own behaviour is tested like any code, with the kit's doubles:

<!-- include: examples/plugin-example/test/plugin.test.ts#behaviour -->
```ts
/** Just enough of a site for these tests: one entry and the site's name. */
const site = {
  id: "site-1",
  readEntry: async () => ({ title: "About", data: { title: "About", hero: { heading: "Fresh bread daily" } }, body: "We bake at dawn. It's warm by six." }),
  summary: async () => ({ name: "Harbour Bakery" }),
} as unknown as SiteService;

describe("behaviour", () => {
  it("fills the Fathom snippet in from its settings", () => {
    const [fathom] = examplePlugin.scriptIntegrations;

    expect(resolveScriptSnippet(fathom!, { siteId: "ABCDEFGH" })).toEqual({ src: "https://cdn.usefathom.com/script.js", attributes: { "data-site": "ABCDEFGH", defer: "" } });
  });

  it("posts one plain sentence to the webhook after a publish", async () => {
    const hook = fakeFetch(() => json(200, { ok: true }));
    const ctx = { ...testContext({ settings: { webhookUrl: "https://hooks.example.com/abc" }, fetch: hook.fetch }), site, siteId: "site-1" };

    await examplePlugin.hooks.afterPublish!(ctx, { ok: true, commit: "1a2b3c4", files: ["src/content/pages/about.md", "public/images/loaf.webp"], pushed: true });
    expect(hook.requests).toEqual([expect.objectContaining({ url: "https://hooks.example.com/abc", method: "POST", body: { text: "Harbour Bakery: 2 files published." } })]);
  });

  it("counts the words in an entry's body and fields", async () => {
    const [tool] = examplePlugin.tools;
    const ctx = { ...testContext(), site, siteId: "site-1", mode: "content" as const, signal: new AbortController().signal };

    // Body: 8 words ("It's" is one); fields: "About" and "Fresh bread daily" — 4.
    expect(await tool!.run({ path: "src/content/pages/about.md" }, ctx)).toEqual({ title: "About", words: 12, body: 8, fields: 4 });
  });
});
```

## Naming and publishing

- Call the package `galley-plugin-<name>` (or `@scope/galley-plugin-<name>`)
  and give it the keyword `galley-plugin` — that is how `galley plugin add`
  recognises it and how people find it on npm.
- Export the plugin as the module's default export (or as `plugin`).
- Set `apiVersion: 1`. A plugin written for another version is refused with
  a message saying so, rather than half-working.
- Depend on `@galley/plugin-kit` only for what you use at run time
  (`ProviderError`, `resolveScriptSnippet`); for types alone it can be a dev
  dependency. Installing runs with `--ignore-scripts`, so ship built
  JavaScript, not TypeScript that needs a build on install.

`examples/plugin-example` is the template to copy: a script integration, a
publish webhook and a read-only tool, with its tests. It ships its built
`dist/` (run `npm run build` after changing `src/`), so a copy of the folder
installs as it is: `galley plugin add ./galley-plugin-example`.

## How first-party plugins are built

First-party plugins live in `packages/plugins/<name>` and are written against
`@galley/plugin-kit` only — no private engine imports — exactly as a third
party would write them. The server registers them as built-ins at start-up
(so a built-in may give its secret a shared name), and they can be turned off
like any installed plugin. `@galley/plugin-openrouter` is the first: images
and video through OpenRouter on one key, with the model lists and prices read
from OpenRouter's catalogue at run time. `@galley/plugin-shopify` is the second: a
store's products for a site — data sources for product and collection
fields, read-only store tools, a publish check, and a product-copy tool
behind a switch ([docs/shopify.md](shopify.md)).
