// Debug builds only — see selftest.rs.
(async function () {
  var FRAME_URL = __FRAME_URL__;
  var out = { page: window.location.href };
  var settle = function (promise) {
    return Promise.resolve(promise).then(
      function (value) {
        return { ok: true, value: value === undefined ? null : value };
      },
      function (error) {
        return { ok: false, error: String((error && error.message) || error).split("\n")[0] };
      }
    );
  };
  // WebKit reports at most 1000 characters of a title, so the results go out in numbered pieces.
  var report = async function (text) {
    var size = 800;
    var total = Math.ceil(text.length / size);

    for (var i = 0; i < total; i += 1) {
      document.title = "SELFTEST:" + (i + 1) + "/" + total + ":" + text.slice(i * size, (i + 1) * size);
      await new Promise(function (resolve) {
        setTimeout(resolve, 100);
      });
    }
  };
  var bridge = window.__GALLEY_DESKTOP__;

  out.bridge = { present: !!bridge, version: bridge && bridge.version, frozen: !!bridge && Object.isFrozen(bridge), keys: bridge ? Object.keys(bridge).sort() : [] };
  out.openExternalJavascript = await settle(bridge.openExternal("javascript:alert(1)"));
  out.openExternalFile = await settle(bridge.openExternal("file:///etc/passwd"));
  out.revealNotASite = await settle(bridge.revealInFinder("/etc"));
  out.revealRelative = await settle(bridge.revealInFinder("etc"));
  var invoke = window.__TAURI_INTERNALS__.invoke;
  out.startupCommandFromApp = await settle(invoke("startup_retry"));
  out.dialogPluginFromApp = await settle(invoke("plugin:dialog|open", { options: {} }));
  out.openerPluginFromApp = await settle(invoke("plugin:opener|open_url", { url: "https://example.com/" }));
  out.frame = await new Promise(function (resolve) {
    var frameOrigin = new URL(FRAME_URL).origin;
    var loaded = false;
    var timer = setTimeout(function () {
      resolve({ loaded: loaded, message: null });
    }, 10000);
    window.addEventListener("message", function (event) {
      if (event.origin !== frameOrigin) return;
      clearTimeout(timer);
      resolve({ loaded: true, message: event.data });
    });
    var frame = document.createElement("iframe");

    frame.src = FRAME_URL;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:4px;height:4px;opacity:0.01;border:0";
    frame.onload = function () {
      loaded = true;
    };
    document.body.appendChild(frame);
  });
  await report(JSON.stringify(out));
})().catch(function (error) {
  document.title = "SELFTEST:1/1:" + JSON.stringify({ crashed: String((error && error.message) || error).slice(0, 200) });
});
