// The start-up window: shows what the shell reports (startup_state) and
// sends the person's choice back. The product's name comes from the shell.
(function () {
  "use strict";

  var DOWNLOADS = {
    git: "https://git-scm.com/downloads",
    node: "https://nodejs.org/en/download",
  };
  var TOOL_COPY = {
    git: {
      name: "git",
      use: "Publishing and version history use it.",
      // xcode-select only means something on a Mac.
      extra: /Mac/.test(navigator.platform) ? " On a Mac you can also run xcode-select --install in Terminal." : "",
      action: "Get git",
    },
    node: { name: "Node.js", use: "Your site’s preview runs on it. Choose the LTS version.", extra: "", action: "Get Node.js" },
  };
  var last = "";

  function invoke(command, args) {
    return window.__TAURI_INTERNALS__.invoke(command, args || {});
  }

  function show(id) {
    ["starting", "missing", "failed"].forEach(function (state) {
      document.getElementById(state).hidden = state !== id;
    });
  }

  function text(id, value) {
    document.getElementById(id).textContent = value;
  }

  function joinNames(names) {
    return names.length === 2 ? names[0] + " and " + names[1] : names[0];
  }

  function renderMissing(view) {
    var missing = view.tools.filter(function (tool) {
      return !tool.found;
    });
    var names = missing.map(function (tool) {
      return TOOL_COPY[tool.id].name;
    });
    var list = document.getElementById("tools");

    text("missing-title", missing.length === 1 ? names[0] + " isn’t installed" : joinNames(names) + " aren’t installed");
    text(
      "missing-body",
      view.product +
        " can still open your sites and edit them. " +
        (missing.length === 1 ? "Previews and publishing need it" : "Previews and publishing need them") +
        ". After installing, choose Check again."
    );
    text("continue", missing.length === 1 ? "Continue without it" : "Continue without them");
    list.textContent = "";
    missing.forEach(function (tool) {
      var copy = TOOL_COPY[tool.id];
      var item = document.createElement("li");
      var words = document.createElement("div");
      var name = document.createElement("strong");
      var use = document.createElement("span");
      var get = document.createElement("button");

      name.textContent = copy.name;
      use.textContent = copy.use + copy.extra;
      get.type = "button";
      get.className = "link";
      get.textContent = copy.action;
      get.addEventListener("click", function () {
        invoke("open_external", { url: DOWNLOADS[tool.id] }).catch(function () {});
      });
      words.appendChild(name);
      words.appendChild(use);
      item.appendChild(words);
      item.appendChild(get);
      list.appendChild(item);
    });
    text(
      "missing-detail",
      view.tools
        .map(function (tool) {
          return tool.id + ": " + (tool.found ? tool.version + " (" + tool.path + ")" : tool.path ? "found at " + tool.path + " but it didn’t answer" : "not found");
        })
        .join("\n") +
        "\n\nLooked in:\n" +
        view.path.join("\n")
    );
  }

  var FAILED_COPY = {
    stopped: function (product) {
      return [product + " stopped", "It stopped unexpectedly. Your sites and unpublished changes are safe: they’re files on this computer."];
    },
    timeout: function (product) {
      return ["Couldn’t start", product + " took too long to start. Your sites and their changes are safe."];
    },
    missing: function (product) {
      return ["Couldn’t start", "This copy of " + product + " is incomplete. Reinstall it. Your sites and their changes are safe."];
    },
    other: function (product) {
      return ["Couldn’t start", product + " didn’t start. Your sites and their changes are safe."];
    },
  };

  function renderFailed(view) {
    var copy = (FAILED_COPY[view.reason] || FAILED_COPY.other)(view.product);

    text("failed-title", copy[0]);
    text("failed-body", copy[1]);
    text("failed-detail", [view.detail].concat(view.log.length ? ["", "Last lines of output:"].concat(view.log) : []).join("\n"));
    document.getElementById("retry").disabled = false;
  }

  function render(view) {
    var key = JSON.stringify(view);

    if (key === last) return;
    last = key;
    document.title = view.product;
    document.querySelectorAll("[data-product]").forEach(function (node) {
      node.textContent = view.product;
    });
    if (view.phase === "missingTools") {
      renderMissing(view);
      show("missing");
    } else if (view.phase === "failed") {
      renderFailed(view);
      show("failed");
      document.getElementById("retry").focus();
    } else {
      show("starting");
    }
  }

  function poll() {
    invoke("startup_state").then(
      function (view) {
        render(view);
        setTimeout(poll, view.phase === "starting" ? 200 : 500);
      },
      function () {
        setTimeout(poll, 1000);
      }
    );
  }

  document.getElementById("retry").addEventListener("click", function (event) {
    event.currentTarget.disabled = true;
    last = "";
    show("starting");
    invoke("startup_retry");
  });
  document.getElementById("check-again").addEventListener("click", function () {
    last = "";
    show("starting");
    invoke("startup_retry");
  });
  document.getElementById("continue").addEventListener("click", function () {
    last = "";
    show("starting");
    invoke("startup_continue");
  });
  document.getElementById("quit").addEventListener("click", function () {
    invoke("startup_quit");
  });
  poll();
})();
