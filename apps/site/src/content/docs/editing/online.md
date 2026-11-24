---
title: Put the site online
description: Give the site a real address on Cloudflare or Vercel in four steps, put published versions live, and share a preview link before you publish.
group: site
order: 7
---

For people who look after a site. Galley can put the site at a real address on **Cloudflare** or **Vercel** — even a site that exists only on your computer. *Status: Cloudflare built and verified on the real service by the people who built it; Vercel built, not yet verified on the real service.* The docs walked through the steps up to the access key and did not contact either host.

What's live is what you've published: putting the site online builds the last published version, never the changes still waiting in Proof.

## Set it up

1. Press **Put this site online** (on **Site home**, **Online**, or the status bar).
2. **Where the site lives**: choose **Cloudflare** (recommended) or **Vercel**, then **Continue**.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/online-setup@1x.webp" srcset="/docs/online-setup@1x.webp 1x, /docs/online-setup.webp 2x" alt="Step 1 of 4 of Put this site online: Cloudflare, marked Recommended, and Vercel, each with a line about what it suits and a link to its prices, and the buttons Not now and Continue." width="680" height="347" loading="lazy" decoding="async"></figure>

3. **Connect Cloudflare** (or Vercel): make an access key on the host's site and paste it in **Access key**, then **Connect**. For Cloudflare, **Open Cloudflare's page** opens its Create Token form already filled in; choose the account under *Account Resources*, then *Continue to summary* and *Create Token*, and copy the key — it's shown once. The key is checked with the host before it is saved, kept on this computer only, and afterwards only its last four characters are shown.
4. **Choose the account** (or team), then **Name it** — the project name becomes part of the address — and **Put it online**.

The address appears when it's done. **Put changes live every time I publish** makes each publish go live by itself; off, you choose when with **Put live**. Galley also offers to use the new address as the live site Proof compares against.

## Share a preview link

In **Proof**, **Share a preview link** puts the site as it is now — unpublished changes included — at an address of its own. On Cloudflare anyone with the link can open it; on Vercel, visitors must sign in to your team unless you turn its Deployment Protection off.

## See what's live

**Online** in the sidebar lists every deployment made from this computer. The status bar says when published versions aren't live yet.

## Your own domain

Galley first puts the site at the host's own address (`…workers.dev` or `…vercel.app`). To use an address of yours, such as `www.example.com`, choose **Use your own domain…** on the **Online** screen. Galley shows what will change, attaches the address when you say yes, waits until it answers over HTTPS, then makes it the site's live address. It never replaces a DNS record that is already there. On Cloudflare the domain has to be in the same account as the site; on Vercel you're shown the one DNS record to add where your domain's DNS is managed. *Status: new in 0.1.1; attaching a fresh address is tested against stand-ins of the hosts, not yet on the real services.* The details: [Deploying, for developers](/docs/running/deploy/#your-own-domain).

## If something's different

- **"…didn't accept the access key."** The key was deleted, expired or mistyped; make a new one and paste it in the key step.
- **"This Cloudflare account doesn't have a workers.dev address yet."** Open *Workers & Pages* in Cloudflare's dashboard once and choose one.
- **"Nothing has been published yet."** Publish first; a preview link works before that.
- **"The site's own build stopped with a problem."** The live site is unchanged. The last lines of the build are under **Technical details** — a job for whoever looks after the site's code.

Costs are the host's: see Cloudflare's and Vercel's prices from the first step. Developers: [Deploying, for developers](/docs/running/deploy/).

To edit the site from any browser too, put its editor online the same way: [Host the editor online](/docs/editing/editor-online/).
