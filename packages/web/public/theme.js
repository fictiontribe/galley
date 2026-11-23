// Applies the last known theme before the app's styles paint, so a dark
// setting never flashes light. The server's setting is the source of truth;
// this reads the copy the app keeps in localStorage ("galley.ui").
try {
  var saved = JSON.parse(localStorage.getItem("galley.ui") || "{}");
  var theme = saved && saved.state && saved.state.theme;
  if (theme === "light" || theme === "dark" || theme === "system") document.documentElement.dataset.theme = theme;
} catch (e) {}
