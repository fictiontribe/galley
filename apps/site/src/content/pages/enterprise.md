---
title: Galley for enterprise and security teams
description: Static production behind Cloudflare, plain files in your own Git repository, OpenID Connect SSO, and a self-hostable editing UI you can run inside your own cloud.
sections:
  - type: hero
    layout: split
    eyebrow: For enterprise and security teams
    heading: Enterprise governance, without a CMS server on your live site.
    text: Give marketing and content teams visual editing, AI, and side-by-side proof — while keeping production purely static behind Cloudflare, every word in your own Git repository, and sign-in on your own identity provider.
    cta:
      label: Talk to Fiction Tribe
      href: "{makerContact}"
    secondary:
      label: Read the security model
      href: "/docs/running/security/"
    note: Opens Fiction Tribe’s contact page.
    visual:
      kind: screen
      src: proof-changes
      alt: Galley’s Proof view showing proposed copy edits struck out and written in beside the live page before publishing.
    caption: Every edit — typed, clicked on the page, or drafted with AI — waits in Proof before a commit touches your repository.

  - type: lists
    id: security
    heading: Secure because the live site runs nothing.
    text: Most CMS vulnerabilities come from a public database, a dynamic server rendering every visit, or third-party plugins running in production. Galley takes all three off the live domain.
    columns:
      - title: On your live domain
        mark: stet
        points:
          - Pre-built HTML, CSS, and static files
          - No runtime database or query surface
          - Consent-gated analytics and third-party scripts (`_headers`, `_redirects`, and built-in consent banner)
      - title: Gone from production
        mark: delete
        points:
          - No SQL database or ORM to inject
          - No public CMS sign-in page on your marketing domain
          - No dynamic plugin chain executing on visitor requests
      - title: Inside the isolated editor
        mark: insert
        points:
          - One site per container or VM — ten sites share no folder, session, or key
          - "`Host` and `Origin` checks, `SameSite=Strict` `__Host-` cookies, and separate-origin preview sandboxing"
          - Guarded write surface that refuses `.git/`, `.env*`, and `node_modules/` in content mode

  - type: band
    id: git-integrity
    heading: Data integrity is plain files and your existing git.
    text: There is no proprietary content database to corrupt, sync, or migrate out of. Every publish is a clean commit or pull request in your own GitHub, GitLab, or Bitbucket repository — with named author attribution, surgical byte-range edits that leave surrounding formatting untouched, and instant rollback as a normal commit. If you ever leave Galley, your repository and static build keep working unchanged.
    link:
      label: How surgical edits work
      href: /docs/concepts/surgical-edits/
    terminal:
      title: git log -p -1
      note: Surgical edit · formatting untouched
      label: Example git commit produced by publishing a copy change in Galley
      lines:
        - "$ git log -p -1"
        - "commit 8c41f2a9d0b7e3c1a52f0948e1d7c6a2b9304f18 (HEAD -> main)"
        - "Author: Maya Lin <maya@acme.example>"
        - "Date:   Tue Nov 24 14:22:08 2026 -0800"
        - ""
        - "    Update enterprise overview headline"
        - ""
        - "diff --git a/src/content/pages/index.md b/src/content/pages/index.md"
        - "--- a/src/content/pages/index.md"
        - "+++ b/src/content/pages/index.md"
        - "@@ -2,6 +2,6 @@"
        - "# Home page hero — keep under ten words"
        - "title: \"Acme Cloud\""
        - "-headline: \"Ship faster with less friction.\""
        - "+headline: \"Ship static sites with enterprise control.\""
        - "cta_label: \"Talk to sales\""
        - "✓ 1 file changed, 1 insertion(+), 1 deletion(-)"

  - type: split
    id: bring-your-cloud
    eyebrow: Decoupled hosting
    heading: Host on your own cloud. Use Galley purely as the editing GUI for GitHub.
    text: You do not need to move your production hosting to use Galley. Keep your site on AWS, Google Cloud, Azure, Cloudflare, Vercel, Netlify, or an internal CI/CD pipeline watching your repository — Galley connects via an ed25519 SSH deploy key or scoped token, gives editors visual editing and Proof, and writes clean commits or pull requests back to GitHub, GitLab, or Bitbucket.
    points:
      - "**Keep your existing pipeline** — your own CI, security checks, and deployment targets stay in charge of going live"
      - "**Self-host inside your VPC** — run the Apache-2.0 multi-arch container (`ghcr.io/fictiontribe/galley`, read-only root filesystem, `cap_drop: ALL`, zero telemetry) on your own Linux server or cloud behind Caddy, Cloudflare Tunnel, or your corporate proxy"
      - "**Or let Fiction Tribe run the editor** — on [Galley Cloud](/cloud/) (coming soon), each site’s editor is planned to run on its own isolated machine with no public IP address, pushing straight to your repository"
      - "**Monorepo-aware** — point Galley at a subfolder like `apps/site` and files outside that folder are neither editable nor published"
    link:
      label: Run a hosted install
      href: /docs/running/hosted/
    visual:
      kind: screen
      src: publish
      x: -440
      y: -170
      alt: Galley’s Publish dialog preparing a named commit with the exact list of changed files.

  - type: split
    id: sso
    flip: true
    status: hosted-sso
    eyebrow: Identity and access
    heading: Your own SSO, without an enterprise tax.
    text: Hosted Galley editors build OpenID Connect (Authorization Code with PKCE) directly into the open-source server — configured through server environment variables so nobody can alter authentication settings from the browser.
    points:
      - "**Works with standards-compliant OIDC providers** — Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak, and internal OIDC issuers (`GALLEY_OIDC_ISSUER` and `GALLEY_OIDC_CLIENT_ID`)"
      - "**Administrator-controlled role mapping** — map `owner`, `editor`, and `contributor` at every sign-in from an IdP claim, bound to issuer and subject rather than mutable e-mail"
      - "**Passwordless mode & instant offboarding** — disable password sign-in completely with `GALLEY_OIDC_ONLY=1`, and wire OIDC Back-Channel Logout to end active browser, event-stream, and preview sessions immediately"
      - "**Engine-enforced write boundaries** — contributors can edit content and review Proof, while templates, code, `galley.config.json`, and publishing require an editor or owner across the UI, API, and AI tools"
    link:
      label: Identity provider setup
      href: /docs/reference/environment/#signing-in-through-an-identity-provider
    visual:
      kind: screen
      src: people
      fallback: hosted-first-run
      x: -160
      y: -20
      alt: Galley’s People screen showing named accounts and owner, editor, and contributor roles on a hosted install.

  - type: split
    id: cloudflare
    eyebrow: Edge delivery
    heading: Every Galley-hosted site sits behind Cloudflare.
    text: When you deploy through Galley or run on Galley Cloud, your published site is served straight from Cloudflare’s global edge network as pre-built static assets — absorbing traffic spikes at the edge with no origin server behind it.
    points:
      - "**Global edge & DDoS protection** — static files answer from Cloudflare’s network worldwide with automatic HTTPS certificates"
      - "**Custom domains in one DNS record** — attach your domain without handing over registrar passwords"
      - "**Checked redirects, forms, and media buckets** — loop-checked `_redirects`, rate-limited form routing to HubSpot, Marketo, Salesforce, Pardot, or webhooks, and media storage on Cloudflare R2"
    link:
      label: See Galley Cloud
      href: /cloud/
    visual:
      kind: screen
      src: online-domain
      fallback: online-live
      x: -330
      y: -120
      alt: Galley’s custom domain screen setting up a domain and TLS certificate on Cloudflare.

  - type: comparison
    id: compare
    heading: Galley and legacy enterprise CMSs, side by side.
    text: Where older enterprise platforms have more today, the table says so.
    caption: Galley compared with traditional and headless enterprise CMSs
    columns:
      - What teams check
      - Galley
      - Traditional & headless enterprise CMS
    rows:
      - label: Live site attack surface
        ours: Static files behind Cloudflare or your CDN; no live database
        theirs: Dynamic origin server, database, or runtime API dependency
        better: ours
      - label: Data integrity & audit
        ours: Plain files and named commits in your GitHub or GitLab
        theirs: Proprietary database or hosted content API
        better: ours
      - label: Hosting lock-in
        ours: Host anywhere; use Galley purely as a Git editing UI
        theirs: Tied to the vendor’s cloud or runtime infrastructure
        better: ours
      - label: Single sign-on (SSO)
        ours: OpenID Connect + PKCE built into the Apache-2.0 server (new)
        theirs: Usually gated behind custom enterprise contracts
        better: ours
      - label: Tenant isolation
        ours: One isolated container or VM per site
        theirs: Shared multi-tenant database or monolithic cluster
        better: ours
      - label: AI safety
        ours: No shell; content-mode guardrails; every edit waits in Proof
        theirs: Direct database writes or third-party plugins
        better: ours
      - label: Exit path
        ours: Keep your git repository and static build as-is
        theirs: Schema export and front-end rewrite
        better: ours
      - label: Compliance badges & age
        ours: New (released 2026); no SOC 2 badge yet
        theirs: Years of enterprise procurement, SOC 2 / ISO reports, and SLAs
        better: theirs

  - type: faq
    id: questions
    heading: Questions security and engineering teams ask.
    items:
      - q: Can we host on AWS, Azure, or GCP and use Galley strictly as a GUI for GitHub?
        a: Yes. Galley does not require hosting your production site with us. Run the Apache-2.0 container (`ghcr.io/fictiontribe/galley`) inside your own VPC or server — or use the desktop app locally — connect it to GitHub, GitLab, or Bitbucket with a deploy key or scoped token, and let your existing CI/CD pipeline build and deploy to AWS, Google Cloud, Azure, Cloudflare, Vercel, or Netlify. You can also require pull requests so every publish passes your branch protections and required reviews.
      - q: How does Single Sign-On (SSO) work, and what has been verified so far?
        a: Self-hosted installs support OpenID Connect (Authorization Code flow with PKCE) configured exclusively through server environment variables (`GALLEY_OIDC_ISSUER`, `GALLEY_OIDC_CLIENT_ID`). Users are matched by issuer and subject rather than mutable e-mail, roles (`owner`, `editor`, `contributor`) are mapped from an administrator-controlled IdP claim at every sign-in, `GALLEY_OIDC_ONLY=1` turns off password sign-in completely, and OIDC Back-Channel Logout ends active browser, event-stream, and preview sessions immediately. Per our [security model](/docs/running/security/#not-covered-yet), OIDC SSO is new and in final checks — verified against the test suite’s OIDC provider in Chromium and WebKit, not yet run against a live external identity service or in Firefox — and is planned for [Galley Cloud](/cloud/) workspace sign-in.
      - q: Does Galley phone home, collect telemetry, or train AI on our content?
        a: No. Galley has zero telemetry, no vendor account requirement, and makes no outbound calls to Fiction Tribe. Outbound traffic goes only to your git host, your site’s package registry, your configured identity provider, and any AI or mail service you explicitly configure. AI requests leave the server only when someone actively uses the assistant or an AI-assisted feature, using your own API key (or an internal endpoint set via `GALLEY_ANTHROPIC_BASE_URL`). See the full list in [What leaves the machine](/docs/running/security/#what-leaves-the-machine).
      - q: How do you keep non-technical editors from breaking code or layouts?
        a: Four layers work together. Roles separate `contributor`, `editor`, and `owner`, and the engine enforces content mode versus build mode across the UI, HTTP API, and AI tools so contributors cannot edit templates, code, or `galley.config.json`, or publish. Astro’s Zod schemas validate content structure before anything ships, every change waits in Proof beside the live page, and pull-request mode routes publishes through GitHub or GitLab review. As our [security model](/docs/running/security/#a-hosted-install) notes, roles keep people out of each other’s way while the container itself is the hard security boundary, because a site’s preview runs repository code.
      - q: How are backups and disaster recovery handled?
        a: Because every published version is a standard Git commit, your Git host and every clone already hold a complete copy of the site’s content, configuration, and history. For unpublished drafts, accounts, and install state on a self-hosted editor, `galley backup` and the Install page produce a single passphrase-sealed archive encrypted with `scrypt` and `AES-256-GCM` in authenticated frames, verified end-to-end before a restore touches disk. On [Galley Cloud](/cloud/) (coming soon), nightly repository bundles kept 30–90 days are planned alongside your Git history.
      - q: Do you have SOC 2, ISO 27001, or custom enterprise SLAs?
        a: Not yet. Galley is a 2026 product and does not carry a SOC 2 report, ISO 27001 certification, or a published SLA badge today. Teams with strict compliance boundaries can audit the Apache-2.0 source and run the hardened container inside their own audited VPC with zero outbound calls to Fiction Tribe — keeping every credential, repository, and session inside their own perimeter. If you need an architecture review or commercial support, [talk directly with Fiction Tribe]({makerContact}).

  - type: close
    id: talk
    heading: Bring your security checklist and your editors.
    text: Talk directly with the engineers building Galley about your repository, SSO provider, and hosting setup — or start a self-hosted container in your own cloud today.
    actions:
      - label: Talk to Fiction Tribe
        href: "{makerContact}"
      - label: Read the security model
        href: /docs/running/security/
---
