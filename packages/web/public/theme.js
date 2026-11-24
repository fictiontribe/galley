// Applies the appearance (light, dark or the system's) and the theme before
// the app's styles paint, so neither flashes, on every page the app opens on
// (sign-in, first run and one-time links included: they share this one HTML
// page).
//
// The appearance comes from the copy the app keeps in localStorage
// ("galley.ui"; see src/lib/theme.ts). The theme is the install's default,
// which the server puts in front of this script (galleyStart): in local mode
// and the desktop app that is the person's choice, so it wins; on a hosted
// install it applies until this browser's person has chosen their own, kept
// in "galley.look" (src/lib/themes/apply.ts).
//
// Nothing read here reaches the page unless it is exactly what a theme may
// hold: colours written #RRGGBB, switches from their fixed lists.
(function () {
  var root = document.documentElement;
  var HEX = /^#[0-9A-Fa-f]{6}$/;
  var SEEDS = ["paper", "ink", "pencil", "plate", "table"];
  var SWITCHES = { sidebar: ["sheet", "desk", "plate"], assist: ["ruled", "washed"], icons: ["one-tone", "duotone"], depth: ["soft", "lit"] };
  var INKS = { insert: "--proof-insert", delete: "--proof-delete", change: "--proof-change", success: "--success", warning: "--warning", danger: "--danger", info: "--info" };

  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (e) {
      return null;
    }
  }

  function valid(look) {
    if (!look || typeof look !== "object" || typeof look.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(look.id)) return false;
    for (var m = 0; m < 2; m++) {
      var seeds = look[m ? "dark" : "light"];
      if (!seeds) return false;
      for (var i = 0; i < SEEDS.length; i++) if (!HEX.test(seeds[SEEDS[i]])) return false;
    }
    for (var name in SWITCHES) if (!look.switches || SWITCHES[name].indexOf(look.switches[name]) < 0) return false;
    return true;
  }

  try {
    var ui = read("galley.ui");
    var appearance = ui && ui.state && ui.state.theme;
    if (appearance === "light" || appearance === "dark" || appearance === "system") root.dataset.theme = appearance;

    var start = self.galleyStart || null;
    var mine = read("galley.look");
    var fromServer = start && valid(start.look) ? start.look : null;
    var look = fromServer && (start.keeper === "server" || !(mine && mine.chosen)) ? fromServer : mine && valid(mine.look) ? mine.look : fromServer;
    if (!look) return;

    var shown = root.dataset.theme === "dark" || (root.dataset.theme === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    root.setAttribute("data-look", look.id);
    for (var s in SWITCHES) root.setAttribute("data-look-" + s, look.switches[s]);
    for (var j = 0; j < SEEDS.length; j++) {
      root.style.setProperty("--theme-" + SEEDS[j], look.light[SEEDS[j]]);
      root.style.setProperty("--theme-dark-" + SEEDS[j], look.dark[SEEDS[j]]);
    }
    var tuned = (look.tuned && look.tuned[shown]) || {};
    for (var ink in INKS) if (HEX.test(tuned[ink])) root.style.setProperty(INKS[ink], tuned[ink]);
    var people = look.people || {};
    for (var n = 1; n <= 12; n++) if (HEX.test(people[n])) root.style.setProperty("--person-" + n, people[n]);
  } catch (e) {}
})();
