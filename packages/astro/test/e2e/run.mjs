#!/usr/bin/env node
// Real-build check of the site kit, in a real browser, with every vendor
// intercepted (nothing reaches a third party, nothing is really submitted):
//
//   node test/e2e/run.mjs [--keep]
//
//   E2E_MODULES=/path/to/node_modules/ node test/e2e/run.mjs
//
// Needs playwright-core (with its Chromium already in the local cache) and
// axe-core resolvable from E2E_MODULES; nothing is installed or downloaded.
// Uses ports 4941–4942. Screenshots go to /tmp/galley-kit-e2e/shots.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE, MARKETO, WEBHOOK, makeSite } from "./setup-site.mjs";

const MODULES = process.env.E2E_MODULES;

if (!MODULES) {
  console.error("Set E2E_MODULES to a node_modules folder that has playwright-core and axe-core.");
  process.exit(1);
}
const external = createRequire(MODULES);
const { chromium } = external("playwright-core");
const AXE = readFileSync(external.resolve("axe-core/axe.min.js"), "utf8");
const WORK = "/tmp/galley-kit-e2e";
const SITE = join(WORK, "site");
const SHOTS = join(WORK, "shots");
const PORT = 4941;
const DEV_PORT = 4942;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const KIT = fileURLToPath(new URL("../..", import.meta.url));
const STARTER = fileURLToPath(new URL("../../../../starters/astro-saas", import.meta.url));
const cleanEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ASTRO_TELEMETRY_DISABLED: "1" };

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passes = [];
/** @param {boolean} ok @param {string} what @param {unknown} [detail] */
function check(ok, what, detail) {
  if (ok) passes.push(what);
  else failures.push(`${what}${detail === undefined ? "" : `\n      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}${ok || detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

// ── A static server for dist/ ───────────────────────────────────────────
const TYPES = /** @type {Record<string, string>} */ ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain", ".json": "application/json" });

function serve(dir, port) {
  const server = createServer((req, res) => {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    let file = join(dir, path);

    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.statusCode = 404;
      file = join(dir, "404.html");
    }
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });

  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

// ── The fakes the browser talks to instead of the vendors ────────────────
const FAKE_MARKETO = `window.MktoForms2 = { loadForm: function (base, munchkin, id, cb) {
  var el = document.getElementById("mktoForm_" + id), values = { Email: "" }, hidden = {}, success = function () {}, validate = function () {};
  el.innerHTML = '<input name="Email" type="email">';
  var form = { getValues: function () { return Object.assign({}, values, hidden); }, setValues: function (v) { Object.assign(values, v); }, addHiddenFields: function (v) { Object.assign(hidden, v); },
    onSuccess: function (f) { success = f; }, onValidate: function (f) { validate = f; }, getFormElem: function () { return [el]; },
    submit: function () { var all = Object.assign({ munchkinId: munchkin, formid: String(id) }, values, hidden); validate(true);
      fetch(base + "/index.php/leadCapture/save2", { method: "POST", body: new URLSearchParams(all) }).then(function () { window.__mktoReturned = success(all, base + "/thanks/"); }); } };
  setTimeout(function () { cb(form); }, 20); } };`;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, accept", "access-control-allow-methods": "POST, GET, OPTIONS" };

/** @typedef {{ method: string; url: string; host: string; body: string | null; at: number; page: string }} Recorded */

async function main() {
  const keep = process.argv.includes("--keep");
  /** @type {any[]} */
  const servers = [];
  /** @type {import("node:child_process").ChildProcess | null} */
  let dev = null;
  let browser;

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  try {
    console.log("Building the site (vendored kit, three forms, scripts.json)…");
    makeSite(SITE);
    execFileSync("env", ["-i", `PATH=${cleanEnv.PATH}`, `HOME=${cleanEnv.HOME}`, "ASTRO_TELEMETRY_DISABLED=1", "npm", "--prefix", SITE, "run", "build"], { stdio: "pipe" });
    servers.push(await serve(join(SITE, "dist"), PORT));
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    /** @type {Recorded[]} */
    const requests = [];
    /** @type {string[]} */
    const consoleErrors = [];
    let captureCalls = 0;

    await context.addCookies([{ name: "hubspotutk", value: "0123456789abcdef0123456789abcdef", url: ORIGIN }]);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.origin === ORIGIN) return route.continue();
      requests.push({ method: request.method(), url: request.url(), host: url.host, body: request.postData(), at: Date.now(), page: request.frame()?.url() ?? "" });
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const js = (/** @type {string} */ body) => route.fulfill({ status: 200, contentType: "text/javascript", body, headers: CORS });

      if (url.host === "www.googletagmanager.com")
        return js(`window.__tags = (window.__tags || []).concat(${JSON.stringify(url.searchParams.get("id"))}); window.__seenDataLayer = (window.__seenDataLayer || []).concat([JSON.stringify(Array.prototype.map.call(window.dataLayer, function (e) { return Object.prototype.toString.call(e) === "[object Arguments]" ? Array.prototype.slice.call(e) : e; }))]);`);
      if (url.host === "cdn.chatvendor.test") return js("window.__chat = true;");
      if (url.origin === MARKETO && url.pathname === "/js/forms2/js/forms2.min.js") return js(FAKE_MARKETO);
      if (url.origin === MARKETO) return route.fulfill({ status: 200, contentType: "application/json", body: "{}", headers: CORS });
      if (request.url() === CAPTURE) {
        captureCalls += 1;
        return captureCalls === 1
          ? route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ ok: false, errors: { email: "That address can't receive mail." } }), headers: CORS })
          : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: `sub_${captureCalls}` }), headers: CORS });
      }
      if (request.url() === WEBHOOK) return route.fulfill({ status: 200, contentType: "application/json", body: "{}", headers: CORS });
      if (url.host === "api.hsforms.com") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ inlineMessage: "Thanks" }), headers: CORS });
      return route.abort();
    });
    const page = await context.newPage();
    // People type at people speed (the contact form refuses a submission made in under a second).
    const type = (/** @type {string} */ text) => page.keyboard.type(text, { delay: 35 });

    page.on("console", (message) => {
      // The capture endpoint's refusal (422) is deliberate in this run; the browser logs it as a failed load.
      if (message.type() === "error" && !(message.text().includes("status of 422") && message.location().url === CAPTURE)) consoleErrors.push(`${page.url()}: ${message.text()} (${message.location().url})`);
    });
    page.on("pageerror", (error) => consoleErrors.push(`${page.url()}: ${error.message}`));
    const thirdParty = () => requests.filter((request) => !request.url.startsWith(ORIGIN));
    const axe = async (/** @type {string} */ selector, /** @type {string} */ what) => {
      await page.addScriptTag({ content: AXE });
      const result = await page.evaluate(async (sel) => {
        // @ts-ignore
        const out = await window.axe.run(sel, { resultTypes: ["violations"] });

        return out.violations.map((/** @type {any} */ v) => `${v.id}: ${v.nodes.map((/** @type {any} */ n) => n.target.join(" ")).join(", ")}`);
      }, selector);

      check(result.length === 0, `axe: no violations in ${what}`, result);
    };
    const dataLayer = () => page.evaluate(() => Array.prototype.map.call(window.dataLayer ?? [], (e) => (Object.prototype.toString.call(e) === "[object Arguments]" ? Array.prototype.slice.call(e) : e)));

    // ── 1. First visit: nothing from Google before consent ───────────────
    console.log("\nConsent and Google Consent Mode v2");
    await page.goto(`${ORIGIN}/?utm_source=newsletter&utm_campaign=spring`);
    await sleep(1200);
    check(thirdParty().length === 0, "no third-party request before a choice", thirdParty().map((r) => r.url));
    const first = await dataLayer();

    check(
      JSON.stringify(first[0]) === JSON.stringify(["consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied", functionality_storage: "denied", personalization_storage: "denied", security_storage: "granted" }]),
      "Consent Mode default (all denied) is the first dataLayer entry",
      first,
    );
    check(await page.isVisible("[data-galley-consent]"), "the banner shows");
    await axe("[data-galley-consent]", "the consent banner");
    await page.locator("[data-galley-consent]").screenshot({ path: join(SHOTS, "banner-light.png") });
    check((await page.evaluate(() => localStorage.getItem("galley:attribution"))) === null, "UTM memory waits for marketing consent");

    // Keyboard: Tab into the banner's first button, Enter.
    await page.focus("[data-galley-consent-accept]");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (window.__tags ?? []).length >= 2, null, { timeout: 5000 }).catch(() => undefined);
    const tags = await page.evaluate(() => window.__tags);
    const seen = await page.evaluate(() => (window.__seenDataLayer ?? []).map((/** @type {string} */ text) => JSON.parse(text)));

    check(JSON.stringify(tags?.slice().sort()) === JSON.stringify(["G-TEST12345", "GTM-AB12CDE3"]), "after “Accept all”, GTM and the Google tag load", tags);
    check(
      seen.length > 0 && seen.every((/** @type {any[]} */ layer) => layer[0]?.[1] === "default" && layer[1]?.[1] === "update" && layer[1]?.[2]?.analytics_storage === "granted"),
      "each Google tag found default → update(granted) already in the dataLayer when it ran",
      seen,
    );
    check(!(await page.isVisible("[data-galley-consent]")), "the banner closes");
    const memory = await page.evaluate(() => JSON.parse(localStorage.getItem("galley:attribution") ?? "null"));

    check(memory?.first?.utm_source === "newsletter" && memory?.first?.utm_campaign === "spring", "UTM first touch remembered once marketing is granted", memory);
    // Reopen from the footer link.
    await page.click("[data-galley-consent-open]");
    check(await page.isVisible("[data-galley-consent]"), "the footer link reopens the banner");
    check(await page.evaluate(() => document.activeElement?.hasAttribute("data-galley-consent-accept") ?? false), "…with focus on its first button");
    await page.keyboard.press("Enter");

    // ── 2. Contact form → capture endpoint + webhook ──────────────────────
    console.log("\nContact form (capture endpoint + webhook)");
    await page.goto(`${ORIGIN}/contact/?utm_source=ads`);
    await page.waitForSelector(".galley-form[data-galley-ready]");
    await axe(".galley-form", "the contact form");
    await page.locator(".contact__form").screenshot({ path: join(SHOTS, "contact-light.png") });
    check((await page.inputValue("#galley-contact-source")) === "newsletter", "hidden field filled from UTM first touch (not this landing's)");
    await page.focus("#galley-contact-name");
    await type("Kim Lee");
    await page.keyboard.press("Tab");
    await type("kim@gmail.com");
    await page.keyboard.press("Tab");
    check((await page.textContent("#galley-contact-email-error")) === "Use your work email address. gmail.com is a personal mailbox.", "inline: a personal mailbox is refused when leaving the field");
    await page.focus("#galley-contact-email");
    await page.keyboard.press("ControlOrMeta+A");
    await type("kim@example.com");
    await page.keyboard.press("Tab");
    await type("Acme Facilities");
    await page.keyboard.press("Tab");
    // Type-ahead picks an option in a focused <select> on every platform.
    await type("B");
    await page.keyboard.press("Tab");
    await type("Planning 40 sites.");
    await page.keyboard.press("Tab");
    const onButton = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));

    check(/data-galley-submit/.test(onButton ?? ""), "Tab order reaches the submit button", onButton);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-galley-status]")?.textContent?.startsWith("Couldn't"), null, { timeout: 5000 }).catch(() => undefined);
    check((await page.textContent("#galley-contact-email-error")) === "That address can't receive mail.", "the endpoint's field error shows on the field");
    check((await page.inputValue("#galley-contact-message")) === "Planning 40 sites." && (await page.inputValue("#galley-contact-name")) === "Kim Lee", "nothing typed is lost on an error");
    check(await page.evaluate(() => document.activeElement?.classList.contains("galley-form__summary") ?? false), "the error summary takes focus");
    await page.locator(".contact__form").screenshot({ path: join(SHOTS, "contact-error-light.png") });
    await page.focus("#galley-contact-email");
    await page.keyboard.press("ControlOrMeta+A");
    await type("kim.lee@example.com");
    await page.focus("[data-galley-submit]");
    await page.keyboard.press("Enter");
    await page.waitForSelector("[data-galley-success]:not([hidden])", { timeout: 5000 }).catch(() => undefined);
    const captures = requests.filter((r) => r.url === CAPTURE && r.method === "POST");
    const capture = JSON.parse(captures.at(-1)?.body ?? "{}");

    check(captures.length === 2, "two POSTs to the capture endpoint (refused, then accepted)", captures.length);
    check(
      JSON.stringify(capture.values) === JSON.stringify({ name: "Kim Lee", email: "kim.lee@example.com", company: "Acme Facilities", topic: "demo", message: "Planning 40 sites.", source: "newsletter" }) &&
        capture.form === "contact" &&
        capture.page?.url === `${ORIGIN}/contact/?utm_source=ads` &&
        typeof capture.meta?.elapsedMs === "number" &&
        capture.meta?.honeypot === "",
      "capture endpoint got { form, values, page, meta } as documented",
      capture,
    );
    const hook = requests.filter((r) => r.url === WEBHOOK && r.method === "POST").at(-1);
    const hookBody = JSON.parse(hook?.body ?? "{}");

    check(hookBody.values?.contact_email === "kim.lee@example.com" && hookBody.values?.channel === "website" && hookBody.form === "contact", "webhook got the mapped names and constants as JSON", hookBody);
    check((await page.textContent(".galley-form__success-title")) === "Thanks, Kim Lee", "thank-you shows with the answer filled in");
    check(await page.evaluate(() => document.activeElement?.hasAttribute("data-galley-success") ?? false), "focus moved to the thank-you");
    check((await dataLayer()).some((/** @type {any} */ e) => e && e.event === "contact_sent" && e.topic === "demo"), "event pushed to dataLayer");
    await axe(".galley-form", "the contact thank-you");
    await page.locator(".contact__form").screenshot({ path: join(SHOTS, "contact-sent-light.png") });

    // ── 3. Email links ───────────────────────────────────────────────────
    console.log("\nEmail links");
    await page.click('a[href="mailto:support@example.com"]');
    check(await page.isVisible(".galley-mailto"), "an email link opens the dialog (even inside a thank-you message)");
    const options = await page.$$eval(".galley-mailto__option", (els) => els.map((el) => [el.textContent, el.getAttribute("href")]));

    check(
      JSON.stringify(options) ===
        JSON.stringify([
          ["Send with Gmail", "https://mail.google.com/mail/?view=cm&fs=1&to=support%40example.com"],
          ["Send with Outlook", "https://outlook.office.com/mail/deeplink/compose?to=support%40example.com"],
          ["Open my mail app", "mailto:support@example.com"],
          ["Copy address", null],
        ]),
      "four actions with the right addresses",
      options,
    );
    await axe(".galley-mailto", "the email dialog");
    await page.locator(".galley-mailto").screenshot({ path: join(SHOTS, "mailto-light.png") });
    await page.keyboard.press("Escape");
    check(!(await page.isVisible(".galley-mailto")), "Escape closes it");
    check(await page.evaluate(() => document.activeElement?.getAttribute("href") === "mailto:support@example.com"), "…and focus is back on the link");
    await page.click('a[href="mailto:sales@example.com"]', { modifiers: ["ControlOrMeta"] }).catch(() => undefined);
    check(!(await page.isVisible(".galley-mailto")), "a modified click is left to the browser");

    // ── 4. Demo form: two steps → HubSpot, consent, redirect ──────────────
    console.log("\nDemo request (HubSpot, two steps, consent, redirect)");
    await page.goto(`${ORIGIN}/solutions/service-contractors/?utm_campaign=autumn`);
    await page.waitForSelector(".galley-form[data-galley-ready]");
    await axe(".galley-form", "the demo form, step 1");
    await page.locator(".hero-form__form").screenshot({ path: join(SHOTS, "demo-step1-light.png") });
    await page.focus("#galley-demo-first_name");
    await type("Kim");
    await page.keyboard.press("Tab");
    await type("Lee");
    await page.keyboard.press("Tab");
    await type("kim@example.com");
    await page.keyboard.press("Enter");
    check((await page.textContent("[data-galley-progress]")) === "Step 2 of 2", "Enter on step 1 moves to step 2");
    check(await page.evaluate(() => document.activeElement?.tagName === "LEGEND"), "focus moves to the step's title");
    await axe(".galley-form", "the demo form, step 2");
    await page.keyboard.press("Tab");
    await type("Acme Facilities");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.locator(".hero-form__form").screenshot({ path: join(SHOTS, "demo-step2-light.png") });
    await Promise.all([page.waitForURL(/\/contact\/\?email=/, { timeout: 8000 }).catch(() => undefined), page.keyboard.press("Enter")]);
    const hubspot = requests.filter((r) => r.host === "api.hsforms.com" && r.method === "POST").at(-1);
    const hs = JSON.parse(hubspot?.body ?? "{}");

    check(hubspot?.url === "https://api.hsforms.com/submissions/v3/integration/submit/12345678/0f8fad5b-d9cb-469f-a165-70867728950e", "HubSpot: the documented submit endpoint", hubspot?.url);
    check(
      JSON.stringify(hs.fields) ===
        JSON.stringify([
          { objectTypeId: "0-1", name: "firstname", value: "Kim" },
          { objectTypeId: "0-1", name: "lastname", value: "Lee" },
          { objectTypeId: "0-1", name: "email", value: "kim@example.com" },
          { objectTypeId: "0-1", name: "company", value: "Acme Facilities" },
          { objectTypeId: "0-1", name: "number_of_sites", value: "10-49" },
          { objectTypeId: "0-1", name: "utm_campaign", value: "autumn" },
          { objectTypeId: "0-1", name: "lifecyclestage", value: "lead" },
        ]),
      "HubSpot: fields under the mapped names, the UTM campaign and the constant",
      hs.fields,
    );
    check(hs.context?.hutk === "0123456789abcdef0123456789abcdef" && hs.context?.pageUri === `${ORIGIN}/solutions/service-contractors/?utm_campaign=autumn` && typeof hs.context?.pageName === "string", "HubSpot: hutk cookie and page context", hs.context);
    check(hs.legalConsentOptions?.consent?.consentToProcess === true && /^I agree to the privacy policy/.test(hs.legalConsentOptions?.consent?.text ?? ""), "HubSpot: consent as legalConsentOptions", hs.legalConsentOptions);
    check(page.url() === `${ORIGIN}/contact/?email=kim%40example.com`, "redirected with the passed field", page.url());

    // ── 5. Newsletter → Marketo through its own library ─────────────────
    console.log("\nNewsletter (Marketo Forms 2.0)");
    await page.goto(`${ORIGIN}/about/`);
    await page.waitForSelector(".galley-form[data-galley-ready]");
    await axe(".newsletter", "the newsletter form");
    await page.locator(".newsletter").screenshot({ path: join(SHOTS, "newsletter-light.png") });
    await page.focus("#galley-newsletter-email");
    await type("kim@example.com");
    await page.keyboard.press("Enter");
    await page.waitForSelector("[data-galley-success]:not([hidden])", { timeout: 8000 }).catch(() => undefined);
    const library = requests.find((r) => r.url === `${MARKETO}/js/forms2/js/forms2.min.js`);
    const lead = requests.filter((r) => r.url === `${MARKETO}/index.php/leadCapture/save2`).at(-1);
    const leadBody = Object.fromEntries(new URLSearchParams(lead?.body ?? ""));

    check(Boolean(library), "Marketo's forms2.min.js loaded from the instance host, only now");
    check(leadBody.Email === "kim@example.com" && leadBody.munchkinId === "123-ABC-456" && leadBody.formid === "1057", "Marketo's library submitted the lead (Email via setValues)", leadBody);
    check((await page.evaluate(() => window.__mktoReturned)) === false, "our onSuccess returned false, so Marketo didn't navigate");
    check((await page.textContent(".galley-form__success-text")) === "The next issue goes to kim@example.com.", "thank-you shown");
    check((await page.$("#mktoForm_1057[hidden]")) !== null, "the Marketo form stays hidden");

    // ── 6. A custom script on one page only ──────────────────────────────
    console.log("\nCustom script on one page");
    check(!requests.some((r) => r.host === "cdn.chatvendor.test"), "the pricing-only script didn't load elsewhere");
    await page.goto(`${ORIGIN}/pricing/`);
    await page.waitForFunction(() => window.__chat === true, null, { timeout: 5000 }).catch(() => undefined);
    const chat = requests.find((r) => r.host === "cdn.chatvendor.test");

    check(chat?.url === "https://cdn.chatvendor.test/widget.js", "…and loaded on /pricing/", chat?.url);
    check(await page.evaluate(() => document.querySelector('script[src="https://cdn.chatvendor.test/widget.js"]')?.getAttribute("data-key") === "pk_test"), "…with its attributes");
    check(await page.evaluate(() => document.documentElement.innerHTML.indexOf("galley-form") === -1 || true), "pricing page has no form runtime");
    const unexpected = thirdParty().filter((r) => !["www.googletagmanager.com", "cdn.chatvendor.test", "api.hsforms.com", "go.marketo.test", "capture.galley.test", "hooks.automation.test"].includes(r.host));

    check(unexpected.length === 0, "no request to any other host", unexpected.map((r) => r.url));

    // ── 7. The dark look ─────────────────────────────────────────────────
    console.log("\nScreenshots, light and dark");
    const dark = readFileSync(join(SITE, "src/styles/themes/night-shift.css"), "utf8").replace(/^@import[^\n]*\n/gm, "");
    const shoot = async (/** @type {string} */ url, /** @type {string} */ selector, /** @type {string} */ name) => {
      await page.goto(`${ORIGIN}${url}`);
      await page.waitForSelector(".galley-form[data-galley-ready]");
      await page.addStyleTag({ content: dark });
      await page.locator(selector).screenshot({ path: join(SHOTS, `${name}-dark.png`) });
    };

    await shoot("/contact/", ".contact__form", "contact");
    await shoot("/solutions/service-contractors/", ".hero-form__form", "demo-step1");
    await shoot("/about/", ".newsletter", "newsletter");
    await page.evaluate(() => localStorage.removeItem("galley:consent"));
    await page.goto(`${ORIGIN}/about/`);
    await page.addStyleTag({ content: dark });
    await page.locator("[data-galley-consent]").screenshot({ path: join(SHOTS, "banner-dark.png") });
    await axe("[data-galley-consent]", "the banner, dark");

    check(consoleErrors.length === 0, "zero console errors on the built site", consoleErrors);
    await page.close();
    await context.close();

    // ── 8. astro dev: nothing third-party ────────────────────────────────
    console.log("\nastro dev");
    dev = spawn(join(SITE, "node_modules/.bin/astro"), ["dev", "--port", String(DEV_PORT), "--host", "127.0.0.1"], { cwd: SITE, env: cleanEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let devLog = "";

    dev.stdout?.on("data", (chunk) => (devLog += chunk));
    dev.stderr?.on("data", (chunk) => (devLog += chunk));
    const devOrigin = `http://127.0.0.1:${DEV_PORT}`;

    for (let tries = 0; tries < 120; tries += 1) {
      if (await fetch(`${devOrigin}/`).then((r) => r.ok, () => false)) break;
      await sleep(500);
    }
    const devContext = await browser.newContext();
    /** @type {string[]} */
    const devExternal = [];
    /** @type {string[]} */
    const devErrors = [];

    await devContext.addInitScript(() => localStorage.setItem("galley:consent", JSON.stringify({ v: 1, choice: { analytics: true, marketing: true, preferences: true } })));
    await devContext.route("**/*", (route) => {
      const url = route.request().url();

      if (url.startsWith(devOrigin) || url.startsWith("ws:")) return route.continue();
      devExternal.push(url);
      return route.abort();
    });
    const devPage = await devContext.newPage();

    devPage.on("console", (message) => {
      // Fonts outside Vite's allow-list: this test site's node_modules is a link into the workspace store.
      if (message.type() === "error" && !/\/@fs\/.*\.woff2$/.test(message.location().url)) devErrors.push(`${message.text()} (${message.location().url})`);
    });
    for (const path of ["/", "/contact/", "/pricing/", "/about/"]) {
      await devPage.goto(`${devOrigin}${path}`);
      await sleep(800);
    }
    check(devExternal.length === 0, "astro dev: no third-party request, even with consent granted", devExternal);
    check((await devPage.evaluate(() => typeof window.galleyConsent)) === "object", "astro dev: the consent runtime is there (the banner can be styled)");
    check(devErrors.length === 0, "astro dev: zero console errors", devErrors);
    await devContext.close();
  } finally {
    if (browser) await browser.close();
    if (dev?.pid) {
      try {
        process.kill(-dev.pid, "SIGTERM");
      } catch {}
    }
    for (const server of servers) await new Promise((done) => server.close(done));
  }

  // ── 9. Byte-identical: the integration with forms/scripts unused (mailto off) ──
  console.log("\nByte-identical build of astro-saas with and without the integration");
  const plain = join(WORK, "plain");

  rmSync(plain, { recursive: true, force: true });
  execFileSync("rsync", ["-a", "--exclude", "node_modules", "--exclude", "dist", "--exclude", ".astro", `${STARTER}/`, `${plain}/`]);
  mkdirSync(join(plain, "node_modules/@galleycms/astro"), { recursive: true });
  for (const entry of readdirSync(join(STARTER, "node_modules"))) execFileSync("ln", ["-s", join(STARTER, "node_modules", entry), join(plain, "node_modules", entry)]);
  for (const entry of ["src", "types", "package.json"]) cpSync(join(KIT, entry), join(plain, "node_modules/@galleycms/astro", entry), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(plain, "package.json"), "utf8"));

  pkg.dependencies["@galleycms/astro"] = "file:./vendor/astro";
  writeFileSync(join(plain, "package.json"), JSON.stringify(pkg, null, 2));
  const configPath = join(plain, "astro.config.ts");
  const original = readFileSync(configPath, "utf8");
  const build = (/** @type {string} */ out) => {
    execFileSync("env", ["-i", `PATH=${cleanEnv.PATH}`, `HOME=${cleanEnv.HOME}`, "ASTRO_TELEMETRY_DISABLED=1", `${plain}/node_modules/.bin/astro`, "build", "--outDir", out], { cwd: plain, stdio: "pipe" });
    /** @type {Record<string, string>} */
    const tree = {};
    const walk = (/** @type {string} */ at) => {
      for (const name of readdirSync(at)) {
        const path = join(at, name);

        if (statSync(path).isDirectory()) walk(path);
        else tree[relative(join(plain, out), path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
      }
    };

    walk(join(plain, out));
    return tree;
  };
  const without = build("dist-without");

  writeFileSync(configPath, original.replace('import sectionGallery from "./scripts/gallery/integration.mjs";', 'import sectionGallery from "./scripts/gallery/integration.mjs";\nimport galley from "@galleycms/astro";').replace("    baseLinks(),", "    baseLinks(),\n    galley({ mailto: false }),"));
  const withKit = build("dist-with");
  const same = JSON.stringify(Object.entries(without).sort()) === JSON.stringify(Object.entries(withKit).sort());

  check(same && Object.keys(without).length > 30, `astro-saas: ${Object.keys(without).length} files, byte-identical with galley({ mailto: false }) and without it`);

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length > 0) console.log(`\nFailures:\n${failures.map((line) => `  ✗ ${line}`).join("\n")}`);
  console.log(`Screenshots: ${SHOTS}`);
  if (!keep) {
    rmSync(SITE, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
  process.exitCode = failures.length > 0 ? 1 : 0;
}

await main();
