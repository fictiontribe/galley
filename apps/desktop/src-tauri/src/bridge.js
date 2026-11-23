// Injected by the desktop shell into the main window's top frame, before the
// page's own scripts. Defines window.__GALLEY_DESKTOP__ and sends links that
// leave the app to the default browser. Inert on any other origin.
(function () {
  "use strict";
  var APP_ORIGIN = __APP_ORIGIN__;
  var VERSION = __APP_VERSION__;

  if (window.location.origin !== APP_ORIGIN || window.top !== window || "__GALLEY_DESKTOP__" in window) return;

  function invoke(command, args) {
    var internals = window.__TAURI_INTERNALS__;

    if (!internals || typeof internals.invoke !== "function") {
      return Promise.reject(new Error("The desktop app isn't reachable from this page."));
    }
    return internals.invoke(command, args || {});
  }

  /** @type {{ version: string, pickFolder(): Promise<string|null>, openExternal(url: string): Promise<void>, revealInFinder(path: string): Promise<void> }} */
  var bridge = Object.freeze({
    version: VERSION,
    pickFolder: function () {
      return invoke("pick_folder");
    },
    openExternal: function (url) {
      return invoke("open_external", { url: String(url) });
    },
    revealInFinder: function (path) {
      return invoke("reveal_in_finder", { path: String(path) });
    },
  });

  Object.defineProperty(window, "__GALLEY_DESKTOP__", { value: bridge, enumerable: false, configurable: false, writable: false });

  // Every link that leaves the app opens in the browser, never in this window.
  document.addEventListener(
    "click",
    function (event) {
      var target = event.target;
      var link = target && typeof target.closest === "function" ? target.closest("a[href]") : null;

      if (!link || event.defaultPrevented) return;
      var url;

      try {
        url = new URL(link.href, window.location.href);
      } catch (error) {
        return;
      }
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== APP_ORIGIN) {
        event.preventDefault();
        bridge.openExternal(url.href).catch(function () {});
      }
    },
    true
  );
})();
