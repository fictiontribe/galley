/**
 * What each built-in host tells the person setting it up — the access-key
 * steps from the host's current docs, what the key allows, preview rules,
 * limits — and the project-name rules. Data and pure functions only, with
 * type-only imports, so the web app's fixture backend can load this file on
 * its own (see packages/web/mock/deploy.ts).
 */
import type { DeployCredentialInfo, DeployTargetInfo } from "../types";

export const VALID_PROJECT = /^[a-z0-9](?:[a-z0-9-]{0,52}[a-z0-9])?$/;
export const MAX_PROJECT_LENGTH = 54;

export function projectNameProblem(name: string): string | null {
  if (!name) return "Give the project a name.";
  if (name.length > MAX_PROJECT_LENGTH) return `Keep the name to ${MAX_PROJECT_LENGTH} characters or fewer.`;
  if (!VALID_PROJECT.test(name)) return "Use lowercase letters, digits and dashes, starting and ending with a letter or digit — like “my-site”.";
  return null;
}

/** "Lowfield Studio" → "lowfield-studio": a name both hosts accept, from the site's own name. */
export function defaultProjectName(siteName: string): string {
  const slug = siteName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PROJECT_LENGTH)
    .replace(/-+$/g, "");

  return slug || "my-site";
}

/**
 * Cloudflare's documented API token template URL
 * (developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/):
 * the dashboard's "Create Token" form opens pre-filled. User-token form:
 * `permissionGroupKeys` (URL-encoded JSON of { key, type }), `accountId` (`*`
 * = all accounts, narrowed by the person in the form), `zoneId` (required;
 * `all` grants nothing without a zone permission), `name`.
 */
export const CLOUDFLARE_TOKEN_PERMISSIONS = [
  { key: "workers_scripts", type: "edit" },
  { key: "account_settings", type: "read" },
] as const;

export const CLOUDFLARE_TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens" +
  `?permissionGroupKeys=${encodeURIComponent(JSON.stringify(CLOUDFLARE_TOKEN_PERMISSIONS))}` +
  "&accountId=%2A&zoneId=all" +
  `&name=${encodeURIComponent("Website publishing")}`;

export const CLOUDFLARE_CREDENTIALS: DeployCredentialInfo[] = [
  {
    secret: "cloudflare",
    label: "Cloudflare access key",
    help: "Cloudflare calls it an API token. It lets this app upload the site to your Cloudflare account. It's kept on this computer only.",
    docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
  },
];

export const CLOUDFLARE_INFO: Omit<DeployTargetInfo, "secrets"> = {
  id: "cloudflare",
  name: "Cloudflare",
  blurb: "Free for most small sites, fast everywhere, and its access key can be limited to just this job.",
  recommended: true,
  credentials: [],
  keySteps: [
    "Open Cloudflare’s page below. It opens “Create Token” already filled in with the two permissions this app needs.",
    "Under “Account Resources”, choose the account the site should live in (it starts as all of your accounts).",
    "Select “Continue to summary”, then “Create Token”.",
    "Copy the key Cloudflare shows — it’s shown only once — and paste it below.",
  ],
  keyStepsByHand: [
    "Open Cloudflare’s API Tokens page (My Profile › API Tokens) and select “Create Token”.",
    "Next to “Create Custom Token”, select “Get started”.",
    "Name it after this site, for example “Website publishing”.",
    "Under “Permissions”, choose Account › Workers Scripts › Edit.",
    "Select “Add more” and choose Account › Account Settings › Read, so the account can be picked from a list. (You can skip this and type the account ID instead.)",
    "Under “Account Resources”, choose Include and the account the site should live in.",
    "Select “Continue to summary”, then “Create Token”.",
    "Copy the key Cloudflare shows — it’s shown only once — and paste it below.",
  ],
  keyUrl: CLOUDFLARE_TOKEN_TEMPLATE_URL,
  keyUrlByHand: "https://dash.cloudflare.com/profile/api-tokens",
  keyGrants:
    "It lets this app create and update Workers — the sites Cloudflare serves — in the accounts the key covers (the one you choose on Cloudflare, or all of them), and read their names. It can't change your domains, DNS, email, billing, or anything else.",
  narrowKey: {
    text: "On Cloudflare's API Tokens page, edit this key and under “Account Resources” choose Include and just the account the site lives in. The key keeps working.",
    url: "https://dash.cloudflare.com/profile/api-tokens",
  },
  accountNoun: "account",
  accountHelp: "The account ID is on the Workers & Pages overview in the Cloudflare dashboard, and in the dashboard's address right after dash.cloudflare.com/.",
  previewNote:
    "Anyone with a preview link can open it. It keeps working until Cloudflare's version retention removes that version, and turning off preview addresses in the Worker's settings stops them all.",
  limits: { maxFiles: 100_000, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: null },
  pricingUrl: "https://developers.cloudflare.com/workers/platform/pricing/",
  domainsUrl: "https://developers.cloudflare.com/workers/configuration/routing/custom-domains/",
};

export const VERCEL_CREDENTIALS: DeployCredentialInfo[] = [
  {
    secret: "vercel",
    label: "Vercel access key",
    help: "Vercel calls it an access token. It lets this app upload the site to your Vercel team. It's kept on this computer only.",
    docsUrl: "https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token",
  },
];

export const VERCEL_INFO: Omit<DeployTargetInfo, "secrets"> = {
  id: "vercel",
  name: "Vercel",
  blurb: "A good fit if your team already uses Vercel. Preview links are private to your team unless you open them up.",
  recommended: false,
  credentials: [],
  keySteps: [
    "Open Vercel’s Account Tokens page below.",
    "Name it after this site, for example “Website publishing”.",
    "Under “Scope”, choose the team the site should live in. Don't limit it to one project: this app needs to create the site's project.",
    "Choose when it expires, then select “Create”.",
    "Copy the key Vercel shows — it's shown only once — and paste it below.",
  ],
  keyUrl: "https://vercel.com/account/tokens",
  keyGrants:
    "Vercel keys can't be limited to particular actions: this one can do anything in the team you chose, so choose that team carefully and delete the key on Vercel if you stop using this app. This app only uses it to create the site's project, upload its files and read its deployments.",
  accountNoun: "team",
  accountHelp: "The team ID is in the team's Settings on Vercel, under General.",
  previewNote:
    "Vercel asks anyone who opens a preview link to sign in with access to your team, unless Deployment Protection is turned off in the project's settings. Previews are kept for as long as the project's deployment retention setting says.",
  limits: { maxFiles: 15_000, maxFileBytes: null, maxTotalBytes: 1024 * 1024 * 1024 },
  pricingUrl: "https://vercel.com/pricing",
  domainsUrl: "https://vercel.com/docs/domains/working-with-domains/add-a-domain",
};
