// Applies the last known theme before the app's styles paint, so a dark
// setting never flashes light, on every page the app opens on (sign-in, first
// run and one-time links included: they share this one HTML page). It reads
// the copy the app keeps in localStorage ("galley.ui"): in local mode and the
// desktop app a copy of the server's setting, on a hosted install the
// person's own theme (see src/lib/theme.ts).
try {
  var saved = JSON.parse(localStorage.getItem("galley.ui") || "{}");
  var theme = saved && saved.state && saved.state.theme;
  if (theme === "light" || theme === "dark" || theme === "system") document.documentElement.dataset.theme = theme;
} catch (e) {}
