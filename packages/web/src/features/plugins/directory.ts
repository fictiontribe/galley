/**
 * Curated plugin directory and AI plugin prompt builder.
 *
 * Works offline with zero third-party network calls (like themes/catalog.ts):
 * lists first-party packages, the repository's example plugin, and curated
 * AI-buildable blueprints that pre-fill the "Create with AI" studio.
 */
export type DirectoryIcon = "image" | "data" | "upload" | "scripts" | "publish" | "form" | "proof" | "chat" | "inbox" | "plugin";

export type DirectoryCategory = "all" | "ai-media" | "commerce" | "forms" | "analytics" | "publishing" | "importers" | "workflows";
export type DirectoryKind = "official" | "community" | "blueprint";

export interface DirectoryPlugin {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: Exclude<DirectoryCategory, "all">;
  kind: DirectoryKind;
  author: string;
  icon: DirectoryIcon;
  capabilities: string[];
  /** Real npm package name (or built-in id) when installable / built in. */
  packageName?: string;
  /** Source or documentation URL. */
  sourceUrl?: string;
  /** Pre-filled idea for the "Create with AI" studio. */
  aiIdea?: string;
}

export const DIRECTORY_CATEGORIES: Array<{ id: DirectoryCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "ai-media", label: "AI & Media" },
  { id: "commerce", label: "Commerce" },
  { id: "forms", label: "Forms & CRM" },
  { id: "analytics", label: "Analytics" },
  { id: "publishing", label: "Publishing" },
  { id: "importers", label: "Importers" },
  { id: "workflows", label: "Workflows" },
];

export const PLUGIN_DOCS_URL = "https://galleycms.com/docs/plugins/";
export const COMMUNITY_SUBMIT_URL = "https://github.com/fictiontribe/galley/discussions/new?category=ideas&title=Plugin+submission%3A+";

export const DIRECTORY_PLUGINS: readonly DirectoryPlugin[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Multi-model image and video generation on one key.",
    description: "Generate images with FLUX, Gemini, GPT Image, or Recraft and video clips with Veo or Kling through a single OpenRouter API key.",
    category: "ai-media",
    kind: "official",
    author: "Galley",
    icon: "image",
    capabilities: ["Image generator", "Video generator"],
    packageName: "@galley/plugin-openrouter",
    sourceUrl: "https://github.com/fictiontribe/galley/tree/main/packages/plugins/openrouter",
  },
  {
    id: "shopify",
    name: "Shopify",
    tagline: "Product pickers, store tools, and publish checks for shops.",
    description: "Connect a Shopify Storefront to pick products and collections in forms, give the assistant store lookup tools, and verify product handles before publish.",
    category: "commerce",
    kind: "official",
    author: "Galley",
    icon: "data",
    capabilities: ["Data sources", "AI tools", "Publish check"],
    packageName: "@galley/plugin-shopify",
    sourceUrl: "https://github.com/fictiontribe/galley/tree/main/packages/plugins/shopify",
  },
  {
    id: "wordpress",
    name: "WordPress Importer",
    tagline: "Migrate posts, pages, media, and redirects in four steps.",
    description: "Import a WordPress site from its live address or an XML export file straight into pending changes you can inspect in Proof.",
    category: "importers",
    kind: "official",
    author: "Galley",
    icon: "upload",
    capabilities: ["Importer"],
    packageName: "@galley/import-wordpress",
    sourceUrl: "https://github.com/fictiontribe/galley/tree/main/packages/import-wordpress",
  },
  {
    id: "plugin-example",
    name: "Starter Example Plugin",
    tagline: "Fathom Analytics, publish webhook, and word-count tool.",
    description: "A complete reference plugin demonstrating script integrations, secret settings, an afterPublish webhook, and a read-only assistant tool.",
    category: "analytics",
    kind: "community",
    author: "Galley",
    icon: "scripts",
    capabilities: ["Script", "Publish hook", "AI tool"],
    packageName: "galley-plugin-example",
    sourceUrl: "https://github.com/fictiontribe/galley/tree/main/examples/plugin-example",
  },
  {
    id: "bp-slack-publish",
    name: "Slack / Discord Publish Notifier",
    tagline: "Post a concise changelog summary to your team channel on publish.",
    description: "An afterPublish hook that sends the commit message, author, and changed pages to a Slack or Discord incoming webhook stored as a secret setting.",
    category: "publishing",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "publish",
    capabilities: ["Publish hook", "Secret setting"],
    aiIdea: "Post a formatted summary (site name, author, commit message, and changed file count) to a Slack or Discord incoming webhook URL on afterPublish. Declare the webhook URL as a required secret setting.",
  },
  {
    id: "bp-notion-forms",
    name: "Notion Form Destination",
    tagline: "Send form submissions straight into a Notion database.",
    description: "Adds a Notion destination to the Forms screen so every contact or lead form submission creates a new row in your chosen Notion database.",
    category: "forms",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "form",
    capabilities: ["Form destination", "Secret setting"],
    aiIdea: "Add a Notion form destination that creates a page in a Notion database on submission. Declare a Notion integration token (secret) and default database ID setting.",
  },
  {
    id: "bp-publish-guard",
    name: "Pre-publish Quality Guard",
    tagline: "Block publishes with missing alt text, broken links, or TODOs.",
    description: "A beforePublish hook that scans changed Markdown files for draft markers, missing image alt text, or localhost links and explains what to fix.",
    category: "publishing",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "proof",
    capabilities: ["Publish check", "Zero dependencies"],
    aiIdea: "Add a beforePublish hook that reads changed Markdown files via the site facade and refuses publish if any image lacks alt text, contains a localhost URL, or leaves a TODO marker — naming the exact file and line.",
  },
  {
    id: "bp-fathom-analytics",
    name: "Fathom / Plausible Analytics",
    tagline: "Cookieless privacy analytics in the Scripts picker.",
    description: "Registers a privacy-first analytics script integration with a Site ID setting and clean script snippet that loads without a cookie banner.",
    category: "analytics",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "scripts",
    capabilities: ["Script integration"],
    aiIdea: "Add a privacy-first analytics script integration (Fathom or Plausible) to the Scripts screen with a required site/domain setting, necessary consent level, and deferred head script snippet.",
  },
  {
    id: "bp-airtable-source",
    name: "Airtable Field Data Source",
    tagline: "Pick live records from an Airtable base inside content forms.",
    description: "Contributes a searchable data source for form fields so editors can reference products, locations, or events stored in Airtable without copy-pasting IDs.",
    category: "workflows",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "data",
    capabilities: ["Data source", "Secret setting"],
    aiIdea: "Add a searchable dataSource backed by an Airtable table (personal access token as a secret setting, base ID and table name as text settings) so editors can pick records from a field picker.",
  },
  {
    id: "bp-linear-tool",
    name: "Linear Editorial Task Tool",
    tagline: "Let the assistant file content or design follow-ups in Linear.",
    description: "Adds a controlled assistant tool (gated by an explicit toggle) that creates a Linear issue linked to the current page when requested in chat.",
    category: "workflows",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "chat",
    capabilities: ["AI tool", "Secret setting"],
    aiIdea: "Add an assistant tool create_linear_issue that creates a Linear issue with title, description, and team ID using a Linear API key stored as a secret setting, gated behind a toggle setting.",
  },
  {
    id: "bp-stripe-catalog",
    name: "Stripe Product Picker",
    tagline: "Reference Stripe products and prices directly on landing pages.",
    description: "Contributes a Stripe product data source and a read-only assistant lookup tool so pricing tables stay in sync with your live Stripe catalog.",
    category: "commerce",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "data",
    capabilities: ["Data source", "AI tool"],
    aiIdea: "Add a Stripe product dataSource and a read-only lookup_stripe_product assistant tool using a restricted Stripe read-only API key (secret setting) to search active products and their prices.",
  },
  {
    id: "bp-newsletter-hook",
    name: "Newsletter Broadcast Hook",
    tagline: "Draft a newsletter issue automatically when a new post publishes.",
    description: "An afterPublish hook that detects newly published blog posts and creates a draft email in Buttondown or Kit using the post title, standfirst, and URL.",
    category: "publishing",
    kind: "blueprint",
    author: "AI Blueprint",
    icon: "inbox",
    capabilities: ["Publish hook", "Secret setting"],
    aiIdea: "Add an afterPublish hook that checks for newly added Markdown posts in the blog collection and creates a draft broadcast in Buttondown via its API using a secret API key setting.",
  },
];

export const AI_STARTER_IDEAS: Array<{ label: string; idea: string }> = [
  {
    label: "Assistant tool",
    idea: "Add a read-only assistant tool that audits all blog posts for missing descriptions, duplicate titles, and word count, returning a concise report.",
  },
  {
    label: "Form destination",
    idea: "Add a form destination that forwards submissions to a custom webhook URL (stored as a secret setting) with a clean JSON payload.",
  },
  {
    label: "Publish check",
    idea: "Add a beforePublish hook that checks changed pages for broken internal links or TODO placeholders and stops the publish with a plain message.",
  },
  {
    label: "Analytics script",
    idea: "Add a script integration for Plausible Analytics with a required domain setting and deferred script snippet in the page head.",
  },
];

/** Builds a crisp, self-contained AI prompt targeting Galley's apiVersion 1 plugin contract. */
export function buildPluginPrompt(idea: string): string {
  const clean = idea.trim();
  return [
    `Create a Galley CMS plugin for this site: ${clean}`,
    "",
    "Follow Galley's plugin contract (apiVersion: 1):",
    "1. Write it as a single self-contained ES module at `./tools/plugin.mjs` (or a descriptive filename in `./tools/`) with zero external npm dependencies if possible (use Node built-ins and the `fetch` provided in context).",
    "2. Default-export a plain `GalleyPlugin` object with `name`, `displayName`, `description`, `version: \"1.0.0\"`, and `apiVersion: 1`.",
    "3. Declare any API keys, tokens, or webhook URLs in `settings` with `secret: true` (never hardcode credentials).",
    "4. Register the plugin path in the site's `galley.config.json` under `\"plugins\": [\"./tools/…\"]` (preserving existing entries).",
    "5. Keep error messages short and plain, and verify the module has valid syntax before finishing.",
  ].join("\n");
}
