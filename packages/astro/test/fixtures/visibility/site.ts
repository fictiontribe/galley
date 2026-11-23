// A small built site, as HTML files the way Astro writes them: what the
// agent-readable output is tested against. Every page has the chrome a real
// site has — header navigation, a footer, scripts, a consent banner, a form —
// so the tests show it is left out of the markdown.

const chrome = (main: string, head: string, extra = "") => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script data-galley-scripts="head">(function(){})()</script>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${head}
    <meta property="og:site_name" content="Ferrow" />
    <link rel="alternate" type="application/rss+xml" title="Ferrow blog" href="/blog/rss.xml" />
    <style>body{color:#111}</style>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header><a href="/">Ferrow home</a><nav aria-label="Main"><ul><li><a href="/about/">About</a></li><li><a href="/blog/">Blog</a></li></ul></nav></header>
    <main id="main">${main}</main>
    <footer><p>© Ferrow. <a href="mailto:hello@example.com">hello@example.com</a></p></footer>
    ${extra}
    <section class="galley-consent" data-galley-consent hidden><p>Cookies and tracking</p><button type="button">Accept all</button></section>
    <script type="module" src="/_astro/page.js"></script>
  </body>
</html>
`;

const meta = (title: string, description: string, path: string, more = "") =>
  `<title>${title} · Ferrow</title><meta name="description" content="${description}" /><link rel="canonical" href="https://www.example.com${path}" /><meta property="og:title" content="${title}" /><meta property="og:image" content="https://www.example.com/images/share.png" />${more}`;

export const PAGES: Record<string, string> = {
  "index.html": chrome(
    `<section data-galley-block="sections.0"><p class="eyebrow">New: offline inspections</p><h1>Every inspection planned, done and <em>proven</em>.</h1><p>Ferrow brings planned maintenance &amp; inspections into one schedule.</p><div class="actions"><a class="button" href="/contact/">Book a demo<svg aria-hidden="true"><path d="M0 0"/></svg></a><a class="button" href="/product/">See how it works</a></div></section>
<section><h2>From the plan to the proof</h2><ul><li>Schedules from templates</li><li>Reminders before anything falls due<ul><li>by email</li><li>in the app</li></ul></li></ul>
<figure><img src="/images/schedule.png" alt="The schedule view, with this week's inspections" width="1200" height="800" /><figcaption>The schedule, shared with contractors.</figcaption></figure>
<img src="/images/divider.svg" alt="" /></section>`,
    meta("Ferrow — maintenance and compliance", "Ferrow puts planned maintenance, inspections and contractor work into one schedule.", "/") + '<meta property="og:type" content="website" />',
  ),
  "about/index.html": chrome(
    `<h1>About Ferrow</h1><p>Started by a facilities manager and an engineer.</p><table><thead><tr><th>Year</th><th>What happened</th></tr></thead><tbody><tr><td>2019</td><td>First customer | a school</td></tr><tr><td>2024</td><td>Twenty-one <strong>thousand</strong> sites</td></tr></tbody></table><blockquote><p>We were tired of finding out from the inspector.</p></blockquote><p data-galley-agent="skip">Internal note</p><form><label>Email <input name="email" /></label><button>Send</button></form>`,
    meta("About Ferrow", "Who started Ferrow, and why.", "/about/"),
    `<div data-galley-agent="include"><p>Registered office: 1 Example Street.</p></div>`,
  ),
  "blog/index.html": chrome(
    `<h1>Blog</h1><ul class="cards"><li><a href="/blog/certificate-register/"><h2>How to run a certificate register</h2><p>A practical guide.</p></a></li></ul><nav aria-label="Pages"><a href="/blog/2/">Older</a></nav>`,
    meta("Blog", "Practical notes on maintenance and compliance.", "/blog/"),
  ),
  "blog/certificate-register/index.html": chrome(
    `<article><header><h1>How to run a certificate register</h1><p>By Joel Marchetti<span class="visually-hidden">Published</span><time datetime="2026-08-20T00:00:00.000Z">August 20, 2026</time><span aria-hidden="true">·</span>4 min read</p></header>
<p>Most lapsed certificates are not missed inspections. Use <code>expires_at</code> and the <a href="/blog/tags/guides/">guides</a>.</p><h2>File by asset</h2><pre class="astro-code" data-language="json"><code><span class="line">{ "asset": "boiler-1",</span>
<span class="line">  "expires": "2027-01-01" }</span></code></pre><p>Read <a href="#top">the start</a> again, or <a href="https://example.org/standard">the standard</a>.</p><iframe src="https://www.youtube-nocookie.com/embed/abc" title="A walk through the register"></iframe></article>`,
    meta("How to run a certificate register", "A lapsed certificate is usually missing paperwork.", "/blog/certificate-register/") +
      '<meta property="og:type" content="article" /><meta property="article:published_time" content="2026-08-20T00:00:00.000Z" /><meta property="article:modified_time" content="2026-09-01T00:00:00.000Z" /><meta property="article:author" content="Joel Marchetti" />',
  ),
  "blog/tags/guides/index.html": chrome(`<h1>Filed under “Guides”</h1><p>Every guide.</p>`, meta("Filed under “Guides”", "Every Ferrow guide.", "/blog/tags/guides/")),
  "contact/index.html": chrome(
    `<h1>Contact</h1><p>A person replies within one working day.</p><div class="galley-form" data-galley-form="contact"><form><p class="galley-form__description">Tell us about your sites.</p><input name="name" /></form><div class="galley-form__success" hidden><p>Thanks</p></div></div>`,
    meta("Contact", "Book a demo or get help.", "/contact/"),
  ),
  "privacy/index.html": chrome(`<h1>Privacy policy</h1><p>What we collect.</p>`, meta("Privacy policy", "What personal information Ferrow collects.", "/privacy/")),
  "thanks/index.html": chrome(`<h1>Thanks</h1><p>We will be in touch.</p>`, meta("Thanks", "Sent.", "/thanks/")),
  "drafts/next/index.html": chrome(`<h1>Next</h1><p>Unfinished.</p>`, meta("Next", "Unfinished.", "/drafts/next/")),
  "old-pricing/index.html": chrome(`<h1>Pricing</h1>`, `<title>Pricing</title><link rel="canonical" href="https://www.example.com/pricing/" />`),
  "secret/index.html": chrome(`<h1>Secret</h1><p>Kept out.</p>`, `<title>Secret</title><meta name="robots" content="noindex, nofollow" />`),
  "404.html": chrome(`<h1>Page not found</h1>`, `<title>Not found</title><meta name="robots" content="noindex" />`),
  "moved/index.html": `<!doctype html><title>Redirecting to: /about/</title><meta http-equiv="refresh" content="0;url=/about/"><meta name="robots" content="noindex"><link rel="canonical" href="https://www.example.com/about/"><body><a href="/about/">Redirecting</a></body>`,
};
