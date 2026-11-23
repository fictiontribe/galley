// @ts-nocheck — plain browser code; its behaviour is tested in test/scripts-runtime.test.ts.
// The scripts runtime: inlined (minified, see scripts/build-inline.mjs) at the
// top of <head> on every page that has managed scripts, a consent mode or UTM
// memory. It is the only code that turns the page's inert snippet blocks
//   <script type="text/plain" data-galley-script="…" data-consent="…" data-load="…">
// into running scripts, so nothing third-party runs unless:
//   - its consent category is granted (necessary always is), and
//   - the page is not inside the editor's preview or one of the form
//     runtime's hidden post frames (unless the entry says inPreview), and
//   - its load moment has come: eager (now), idle, or the first interaction.
// A category granted later (the banner, galleyConsent.set, a consent tool)
// loads its scripts then. Revoking stops future loads; it can't unload a
// script that already ran.
//
// Google Consent Mode v2 (C.gcm): the default state is pushed before any
// Google tag can run, and an update follows every choice — and, on later
// pages, the stored choice right after the default.
//
// Written as one function taking its configuration, so the inlined text is
// the same on every page of a site (one CSP hash). No dependencies, no eval.

/* eslint-disable no-var */
export default function galleyScripts(C) {
  var w = window;
  var d = document;
  var KEY = "galley:consent";
  var CATS = ["analytics", "marketing", "preferences"];
  var state = { necessary: true };
  var stored = null;
  var framed = false;
  var started = {};
  var muted = false;

  try {
    framed = w.top !== w;
  } catch (e) {
    framed = true;
  }
  // The editor marks its frames (name "galley-preview…", or window.__galleyPreview
  // / <html data-galley-preview> set by a proxy); the form runtime names its
  // hidden post frames "galley-post-…". A framed copy of the site served from
  // another host than the site's own is a proxy too.
  var preview =
    /^galley-(preview|post-)/.test(w.name || "") ||
    w.__galleyPreview === true ||
    d.documentElement.hasAttribute("data-galley-preview") ||
    (framed && !!C.host && location.hostname !== C.host);

  try {
    stored = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch (e) {
    stored = null;
  }
  if (!stored || stored.v !== 1 || C.mode !== "banner") stored = null;
  CATS.forEach(function (c) {
    state[c] = C.mode === "none" || C.defaults.indexOf(c) > -1;
  });
  var defaults = JSON.parse(JSON.stringify(state));

  if (stored) {
    CATS.forEach(function (c) {
      state[c] = !!stored.choice[c];
    });
  }

  function gcm(s) {
    var a = s.analytics ? "granted" : "denied";
    var m = s.marketing ? "granted" : "denied";
    var p = s.preferences ? "granted" : "denied";

    return { ad_storage: m, ad_user_data: m, ad_personalization: m, analytics_storage: a, functionality_storage: p, personalization_storage: p, security_storage: "granted" };
  }
  function gtag() {
    w.dataLayer.push(arguments);
  }
  if (C.gcm) {
    w.dataLayer = w.dataLayer || [];
    var first = gcm(defaults);

    if (C.mode === "external") first.wait_for_update = 500;
    muted = true;
    gtag("consent", "default", first);
    if (stored) gtag("consent", "update", gcm(state));
    muted = false;
  }

  function allowed(b) {
    var c = b.getAttribute("data-consent") || "marketing";

    return (c === "necessary" || state[c] === true) && (!preview || b.hasAttribute("data-preview"));
  }
  function activate(b) {
    if (b.__galley) return;
    b.__galley = 1;
    var s = d.createElement("script");
    var attrs = JSON.parse(b.getAttribute("data-attrs") || "{}");

    for (var k in attrs) s.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    if (attrs.async === true) s.async = true;
    var src = b.getAttribute("data-src");

    if (src) s.src = src;
    else s.text = b.text;
    b.parentNode.insertBefore(s, b.nextSibling);
  }
  var idle = [];
  var waiting = [];
  var idleSet = false;
  var waitSet = false;

  function flush(list) {
    list.splice(0).forEach(function (b) {
      if (allowed(b)) activate(b);
    });
  }
  function onIdle() {
    if (idleSet) return;
    idleSet = true;
    var go = function () {
      (w.requestIdleCallback || setTimeout)(function () {
        idleSet = false;
        flush(idle);
      });
    };

    if (d.readyState === "complete") go();
    else w.addEventListener("load", go, { once: true });
  }
  function onInteraction() {
    if (waitSet) return;
    waitSet = true;
    var events = ["pointerdown", "keydown", "scroll", "touchstart"];
    var go = function () {
      events.forEach(function (e) {
        w.removeEventListener(e, go, true);
      });
      waitSet = false;
      flush(waiting);
    };

    events.forEach(function (e) {
      w.addEventListener(e, go, { capture: true, passive: true });
    });
  }
  function consider(b) {
    if (b.__galley || !allowed(b)) return;
    var load = b.getAttribute("data-load");

    if (load === "idle") {
      if (idle.indexOf(b) < 0) idle.push(b);
      onIdle();
    } else if (load === "interaction") {
      if (waiting.indexOf(b) < 0) waiting.push(b);
      onInteraction();
    } else activate(b);
  }
  function blocks(where) {
    return d.querySelectorAll('script[type="text/plain"][data-galley-script]' + (where ? '[data-placement="' + where + '"]' : ""));
  }
  function run(where) {
    started[where] = 1;
    Array.prototype.forEach.call(blocks(where), consider);
    if (where === "body-end") ready();
  }
  function rerun() {
    Array.prototype.forEach.call(blocks(), function (b) {
      if (started[b.getAttribute("data-placement")]) consider(b);
    });
  }

  // UTM memory for forms (same format as client/attribution.js).
  function capture() {
    if (!C.utm || !(state.marketing || C.mode === "none")) return;
    try {
      var url = new URL(location.href);
      var t = {};
      var any = false;

      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id"].forEach(function (k) {
        var v = url.searchParams.get(k);

        if (v) {
          t[k] = v.slice(0, 200);
          any = true;
        }
      });
      if (!any) return;
      t.landing_page = url.origin + url.pathname;
      if (d.referrer) t.referrer = d.referrer.slice(0, 500);
      t.at = new Date().toISOString();
      var m = JSON.parse(localStorage.getItem("galley:attribution") || "{}") || {};

      localStorage.setItem("galley:attribution", JSON.stringify({ first: m.first || t, last: t }));
    } catch (e) {
      /* storage blocked: forms still read the current address */
    }
  }

  function set(choice, persist) {
    CATS.forEach(function (c) {
      if (c in choice) state[c] = !!choice[c];
    });
    if (persist) {
      stored = { v: 1, at: new Date().toISOString(), choice: { analytics: state.analytics, marketing: state.marketing, preferences: state.preferences } };
      try {
        localStorage.setItem(KEY, JSON.stringify(stored));
      } catch (e) {
        /* the choice holds for this page only */
      }
    }
    if (C.gcm) {
      muted = true;
      gtag("consent", "update", gcm(state));
      muted = false;
    }
    capture();
    try {
      d.dispatchEvent(new CustomEvent("galley:consent", { detail: api.get() }));
    } catch (e) {
      /* very old browser */
    }
    rerun();
  }

  // ── The built-in banner ──────────────────────────────────────────────
  var banner = null;
  var opener = null;

  function show(focus) {
    if (!banner) return;
    banner.hidden = false;
    var boxes = banner.querySelectorAll("input[data-category]");

    Array.prototype.forEach.call(boxes, function (i) {
      i.checked = !!state[i.getAttribute("data-category")];
    });
    if (focus) {
      var first = banner.querySelector("button");

      if (first) first.focus();
    }
  }
  function hide() {
    if (!banner) return;
    banner.hidden = true;
    if (opener && opener.focus) opener.focus();
    opener = null;
  }
  function ready() {
    if (banner || C.mode !== "banner") return;
    banner = d.querySelector("[data-galley-consent]");
    if (!banner) return;
    var panel = banner.querySelector("[data-galley-consent-choices]");
    var toggle = banner.querySelector("[data-galley-consent-settings]");
    var save = banner.querySelector("[data-galley-consent-save]");
    var all = function (v) {
      var c = {};

      CATS.forEach(function (k) {
        c[k] = v;
      });
      return c;
    };

    banner.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;

      if (!t) return;
      if (t.hasAttribute("data-galley-consent-accept")) {
        set(all(true), true);
        hide();
      } else if (t.hasAttribute("data-galley-consent-reject")) {
        set(all(false), true);
        hide();
      } else if (t === toggle && panel) {
        var open = panel.hidden;

        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", String(open));
        if (save) save.hidden = !open;
        if (open) {
          var box = panel.querySelector("input:not([disabled])");

          if (box) box.focus();
        }
      } else if (t === save) {
        var c = {};

        Array.prototype.forEach.call(banner.querySelectorAll("input[data-category]"), function (i) {
          c[i.getAttribute("data-category")] = i.checked;
        });
        set(c, true);
        hide();
      }
    });
    banner.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && stored) hide();
    });
    if (!stored && !preview) show(false);
  }
  d.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-galley-consent-open]") : null;

    if (!t) return;
    e.preventDefault();
    ready();
    opener = t;
    show(true);
  });

  // ── Another consent tool decides (consent.mode "external") ───────────
  if (C.mode === "external") {
    // Cookiebot's documented API: window events and Cookiebot.consent.
    var cookiebot = function () {
      var c = w.Cookiebot && w.Cookiebot.consent;

      if (c) set({ analytics: !!c.statistics, marketing: !!c.marketing, preferences: !!c.preferences }, false);
    };

    ["CookiebotOnConsentReady", "CookiebotOnAccept", "CookiebotOnDecline"].forEach(function (e) {
      w.addEventListener(e, cookiebot);
    });
    // Any tool that speaks Google Consent Mode: gtag('consent', 'update', {...}).
    var seen = function (a) {
      if (muted || !a || a[0] !== "consent" || a[1] !== "update" || typeof a[2] !== "object") return;
      var u = a[2];
      var c = {};

      if ("analytics_storage" in u) c.analytics = u.analytics_storage === "granted";
      if ("ad_storage" in u) c.marketing = u.ad_storage === "granted";
      if ("functionality_storage" in u || "personalization_storage" in u) c.preferences = (u.functionality_storage || u.personalization_storage) === "granted";
      set(c, false);
    };
    var dl = (w.dataLayer = w.dataLayer || []);
    var push = dl.push;

    Array.prototype.forEach.call(dl, seen);
    dl.push = function () {
      var r = push.apply(dl, arguments);

      Array.prototype.forEach.call(arguments, seen);
      return r;
    };
  }

  var api = {
    mode: C.mode,
    preview: preview,
    granted: function (c) {
      return c === "necessary" || state[c] === true;
    },
    get: function () {
      return { necessary: true, analytics: !!state.analytics, marketing: !!state.marketing, preferences: !!state.preferences };
    },
    set: function (choice) {
      set(choice || {}, C.mode === "banner");
    },
    open: function () {
      ready();
      show(true);
    },
  };

  w.galleyConsent = api;
  w.galleyScripts = { run: run };
  capture();
  d.addEventListener("DOMContentLoaded", ready);
}
