# Claims in /compare/cloudcannon/

Every statement the article makes about CloudCannon, with the page that
supports it. All read on 2026-11-25. Statements about Galley follow
[`../CLAIMS.md`](../CLAIMS.md) and `src/data/status.json`.

| # | On the page | Source | Read |
| --- | --- | --- | --- |
| 1 | A hosted service, founded in 2013 | "CloudCannon was founded in 2013" — https://cloudcannon.com/company/ | 2026-11-25 |
| 2 | Git-based; content as Markdown, JSON, YAML or TOML files in your repository | "CloudCannon stores content as files in your Git repo — Markdown, JSON, YAML, or TOML — and builds your static site directly from them." — https://cloudcannon.com/ai-info/ | 2026-11-25 |
| 3 | Every saved change is a commit | Saving creates "a permanent record of your changes in your website's files" and triggers a rebuild — https://cloudcannon.com/documentation/user-guides/editing-in-cloudcannon/saving-your-changes/ ; "Every editor action results in a Git commit." — https://cloudcannon.com/llms.txt | 2026-11-25 |
| 4 | Quote: "If you ever leave CloudCannon, you leave with everything." | https://cloudcannon.com/for-developers/ | 2026-11-25 |
| 5 | Builds and hosts the site; you can host elsewhere | "CloudCannon builds and hosts your site (or BYO hosting)." — https://cloudcannon.com/ ; external hosting — https://cloudcannon.com/documentation/developer-articles/what-is-external-hosting/ | 2026-11-25 |
| 6 | Hosts on Cloudflare's network, with SSL, DNS, redirects, forms and password-protected sites | "Hosting is included on all plans (CDN via Cloudflare)" — https://cloudcannon.com/llms.txt ; SSL, DNS, authentication on all plans — https://cloudcannon.com/pricing/ ; `routing.json` redirects — https://cloudcannon.com/documentation/developer-articles/configure-custom-routing/ ; forms — https://cloudcannon.com/documentation/developer-articles/what-is-a-form/ ; "password authentication" — https://cloudcannon.com/documentation/developer-articles/what-is-authentication/ | 2026-11-25 |
| 7 | Standard $55 a month or $49 a month paid yearly, 3 users | https://cloudcannon.com/pricing/ ("$55 / month (USD)", "$49 / month (USD) Paid annually", "3 users") | 2026-11-25 |
| 8 | Team $350 a month or $300 paid yearly, 15 users | https://cloudcannon.com/pricing/ | 2026-11-25 |
| 9 | Enterprise priced on request | "Custom" — https://cloudcannon.com/pricing/ | 2026-11-25 |
| 10 | Unlimited sites on every plan | "We don't charge per site or repository." — https://cloudcannon.com/pricing/ | 2026-11-25 |
| 11 | Extra users $10 a month each | "add more for $10/month per user" — https://cloudcannon.com/pricing/ | 2026-11-25 |
| 12 | Bandwidth 110 GB (Standard), 700 GB (Team); $15 per 100 GB more | https://cloudcannon.com/pricing/ | 2026-11-25 |
| 13 | Lite at $10 a month, for agency partners' smaller clients | "Lite (Partners Only)", "$10 / month", "A pay-as-you go plan for smaller clients." — https://cloudcannon.com/pricing/ ; https://cloudcannon.com/partner-program/ | 2026-11-25 |
| 14 | 21-day trial, no free plan | "Start 21-day trial" — https://cloudcannon.com/pricing/ ; three paid plans — https://cloudcannon.com/documentation/user-guides/subscribe-to-cloudcannon/choose-your-subscription-plan/ (note: https://cloudcannon.com/llms.txt says 14 days; the pricing page and docs say 21) | 2026-11-25 |
| 15 | Starts from a configuration file in the repository root; "the heart of your CloudCannon experience"; "should be the first thing you do" | https://cloudcannon.com/documentation/developer-reference/configuration-file/ ; https://cloudcannon.com/documentation/developer-articles/what-is-the-cloudcannon-configuration-file/ | 2026-11-25 |
| 16 | At minimum it names the site generator and the source folder | https://cloudcannon.com/documentation/developer-articles/create-your-cloudcannon-configuration-file/ | 2026-11-25 |
| 17 | Collections, schemas, inputs and snippets | https://cloudcannon.com/documentation/developer-articles/what-is-a-schema/ ; https://cloudcannon.com/documentation/developer-articles/what-is-a-snippet/ ; https://cloudcannon.com/documentation/llms.txt ("What are inputs?") | 2026-11-25 |
| 18 | Quote: inputs not configured — it "will attempt to determine the correct editing interface for your data using the Input value and key name." | https://cloudcannon.com/documentation/developer-articles/what-is-visual-editing/ | 2026-11-25 |
| 19 | Configuration Mode writes the file as you click | https://cloudcannon.com/documentation/developer-articles/what-is-configuration-mode/ | 2026-11-25 |
| 20 | Visual editing needs markup: `data-editable="text"` or `<editable-text>` | https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/an-overview-of-editable-regions/ | 2026-11-25 |
| 21 | Components edited on the page need an integration package | "Component Editable Regions need an integration" — https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/visually-edit-components/ | 2026-11-25 |
| 22 | The site must build successfully on CloudCannon before the visual editor works | "Before you can use the Visual Editor, you must have at least one successful build on CloudCannon." — https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/configure-your-build-settings/ | 2026-11-25 |
| 23 | Four editors: visual, content, data and source | https://cloudcannon.com/documentation/user-guides/editing-in-cloudcannon/using-cloudcannons-editing-interfaces/ | 2026-11-25 |
| 24 | Pages from components in the visual editor (table: page building) | "Editors build pages from your custom, reusable components." — https://cloudcannon.com/for-developers/ | 2026-11-25 |
| 25 | Quotes: "the CMS your AI tools can actually read"; "AI agents can read, write, and deploy without translation layers or proprietary schemas standing in the way."; "Cursor, Claude Code, GitHub Copilot, a locally hosted model, or something you built yourself."; agents "propose changes on a branch, and those changes go through the same review as any other pull request." | https://cloudcannon.com/ai-llm-cms/ | 2026-11-25 |
| 26 | Calls itself "AI-ready" | Footer label "AI-ready" linking to /ai-llm-cms/ — https://cloudcannon.com/ | 2026-11-25 |
| 27 | Publishes open-source agent skills that help a coding agent move a site onto CloudCannon and configure it | https://cloudcannon.com/ai-llm-cms/ ; https://cloudcannon.com/open-source/ ; https://github.com/CloudCannon/agent-skills | 2026-11-25 |
| 28 | No AI assistant built into the editor found, as of November 2026 (absence) | Looked at: home page, /ai-llm-cms/, /ai-info/, /pricing/ (no AI rows), /for-developers/, /open-source/, /documentation/llms.txt (all doc titles), the 2026 changelog index, the blog index | 2026-11-25 |
| 29 | Quote: "Changes render live in real time, exactly as they'll appear in production." | https://cloudcannon.com/for-developers/ | 2026-11-25 |
| 30 | Saving commits and rebuilds | https://cloudcannon.com/documentation/user-guides/editing-in-cloudcannon/saving-your-changes/ | 2026-11-25 |
| 31 | Pull-request publishing; quote "must be reviewed and approved by another Organization Member in your Git Provider" | https://cloudcannon.com/documentation/user-articles/what-are-publishing-methods/ | 2026-11-25 |
| 32 | Branching workflows and deploy previews on Team and Enterprise | https://cloudcannon.com/documentation/user-articles/what-is-a-project/ ; https://cloudcannon.com/pricing/ (Deploy Previews: Team, Enterprise) | 2026-11-25 |
| 33 | Builds with your own build command on every push | "CloudCannon connects to your Git repo and builds your static site with every push." — https://cloudcannon.com/ ; build command setting — https://cloudcannon.com/documentation/developer-guides/set-up-visual-editing/configure-your-build-settings/ | 2026-11-25 |
| 34 | Five default roles: Owners, Developers, Technical Editors, Editors and Billing, on every plan | https://cloudcannon.com/documentation/user-articles/what-are-default-permission-groups/ | 2026-11-25 |
| 35 | Custom permission groups narrowed to files, on Team and Enterprise | "Define file globs and exceptions for each Group" — https://cloudcannon.com/documentation/developer-articles/what-are-custom-permission-groups/ ; https://cloudcannon.com/pricing/ | 2026-11-25 |
| 36 | Single sign-on through SAML on Enterprise | https://cloudcannon.com/documentation/developer-articles/what-is-sso-saml/ | 2026-11-25 |
| 37 | SOC 2 Type 2 | "CloudCannon has achieved SOC 2 Type 2 certification" — https://cloudcannon.com/security/ | 2026-11-25 |
| 38 | Quote: "One person can edit a file at a time, while others can view the changes in real time"; avatars show who is where | https://cloudcannon.com/documentation/user-guides/editing-in-cloudcannon/editing-sessions-and-collaboration/ | 2026-11-25 |
| 39 | Uptime agreement (Enterprise), support | "Service Level Agreement to guarantee uptime on your site." (Enterprise); Standard/Priority/Dedicated support — https://cloudcannon.com/pricing/ | 2026-11-25 |
| 40 | Changelog going back to 2015 | Year archives 2015–2026 — https://cloudcannon.com/documentation/changelog/ | 2026-11-25 |
| 41 | Open-source tools Pagefind, Bookshop, Rosey | https://cloudcannon.com/open-source/ ; https://github.com/CloudCannon/bookshop ; https://github.com/CloudCannon/rosey ; https://github.com/Pagefind/pagefind | 2026-11-25 |
| 42 | The CMS isn't described as open source; no self-hosted version for editors; its command-line tool can run the app against local files, for developers | None of /ai-info/, /pricing/, /open-source/ describes the app as open source or offers a self-hosted version; `cloudcannon dev` "runs a local dev server that loads the CloudCannon app against your local files" — https://cloudcannon.com/documentation/developer-reference/cli/ ; "Your editors never see it." — https://cloudcannon.com/blog/preview-automate-and-extend-cloudcannon/ | 2026-11-25 |
| 43 | On leaving: files stay in your repository; hosted domains go offline; you can no longer edit | "When you cancel, you can no longer edit your Sites, your hosted domains (including Testing Domains) become unavailable … Your Sites and files are not deleted." — https://cloudcannon.com/documentation/user-articles/cancel-your-subscription/ | 2026-11-25 |
| 44 | CloudCannon's own files: `cloudcannon.config.*`, the `.cloudcannon` folder, editable-region attributes | https://cloudcannon.com/documentation/developer-reference/site-configuration/ ; Editable Regions overview (row 20) | 2026-11-25 |
| 45 | Its forms, redirects and hosting stop with it | "Forms are only available for Sites hosted through CloudCannon." — what-is-a-form ; hosting features "only apply to the Sites CloudCannon hosts" — https://cloudcannon.com/documentation/developer-articles/what-is-external-hosting/ | 2026-11-25 |
| 46 | Since August 2026 its command-line tool's `configure generate` finds the content collections and suggests build settings, though not the inputs | "Generate and validate config with SSG auto-detection" — https://cloudcannon.com/for-developers/ ; generates "collections config and build settings, but not `_inputs` or `_structures`" — https://cloudcannon.com/blog/preview-automate-and-extend-cloudcannon/ (20 Aug 2026) | 2026-11-25 |
| 47 | Editing on the page needs Editable Regions markup; the sidebar of fields works without | https://cloudcannon.com/documentation/developer-articles/what-is-visual-editing/ | 2026-11-25 |
| 48 | Shows a list of the files that changed, with the line-by-line difference on your Git host (table: "a list of changed files") | Changes tab ("the number of lines changed"), Commits tab, "Compare changes" link to the Git provider — https://cloudcannon.com/documentation/user-articles/what-is-the-publishing-page/ | 2026-11-25 |
| 49 | Pull-request publishing is a publishing method (no plan restriction stated); branching workflows and deploy previews on Team | https://cloudcannon.com/documentation/user-articles/what-are-publishing-methods/ ; "Sites on our Standard plan can still publish to a Publish Branch" — https://cloudcannon.com/documentation/user-articles/what-is-publishing/ ; pricing table | 2026-11-25 |
| 50 | Component editing for years; the newer Component Editable Regions now cover most frameworks | Bookshop, "an alternative (and older) approach" — https://cloudcannon.com/llms.txt ; Component Editable Regions extended to Eleventy, Hugo, Vue, Svelte, Next.js, Nuxt and SvelteKit — https://cloudcannon.com/documentation/changelog/2026/10/15/component-editable-regions-for-more-ssgs/ | 2026-11-25 |
| 51 | Enforced two-factor sign-in (Team and Enterprise) | "Enforced multi-factor authentication is available on our Team or Enterprise Plan." — https://cloudcannon.com/documentation/developer-articles/enforce-multi-factor-authentication/ | 2026-11-25 |
| 52 | Scheduled publishing, with more of it on Team | "Content scheduling" (Standard), "Advanced content scheduling" (Team, Enterprise) — https://cloudcannon.com/pricing/ ; https://cloudcannon.com/documentation/developer-articles/scheduling-your-next-build-automatically/ | 2026-11-25 |
| 53 | Its open-source Rosey tool is built for sites in several languages | Rosey listed for translations — https://cloudcannon.com/open-source/ ; https://github.com/CloudCannon/rosey | 2026-11-25 |
| 54 | Connects to image stores such as Amazon S3, Cloudinary or Azure | "Connect external asset stores or Digital Asset Management platforms such as Amazon S3, Cloudinary, and Azure." — https://cloudcannon.com/pricing/ | 2026-11-25 |

Not used, because CloudCannon's own pages disagree or don't say: the trial's
length on `llms.txt` (14 days, against 21 elsewhere); whether SAML visitor
authentication is on Team; an audit log by that name; build-time limits on
Team and Enterprise.

Checked again by someone who did not write the article on 2026-11-25: 60
statements confirmed, ten corrected on the page (rows 42 and 46–50 came from
that check), none found wrong.
