// @ts-nocheck — plain browser code, minified into runtime.gen.js; tested in test/mailto.test.ts.
// Email links, the Galley way: activating an `a[href^="mailto:"]` opens a
// small dialog next to the link offering Gmail, Outlook on the web, the
// visitor's own mail app (the original link, untouched) and copying the
// address — so nobody is dropped into a mail program they don't use.
//
// - One click listener and one keydown listener on the document, doing
//   nothing until a mailto link is activated. No styles until first opened.
// - Never intercepted: modifier keys, middle/right click, context menu, links
//   with `download`, `data-galley-mailto="off"` on the link or an ancestor,
//   clicks another script already handled (the editor's click-to-edit mode
//   swallows them in the capture phase, so the editor always wins).
// - A non-modal dialog, not a menu: it holds the address (selectable) and a
//   live "Copied" status as well as the four actions, which a menu may not.
//   Arrow keys move between the actions; Tab works as usual; Escape or a
//   click outside closes it and returns focus to the link.
export default function galleyMailto(C) {
  let d = document;
  let w = window;
  let S = C.strings;
  let box = null;
  let link = null;
  let styled = false;

  function dec(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      // A stray "%" or broken UTF-8: decode the sequences that are valid.
      return s.replace(/(%[0-9a-f]{2})+/gi, (m) => {
        try {
          return decodeURIComponent(m);
        } catch (x) {
          // Keep broken UTF-8 bytes as written; plain ASCII escapes still decode.
          return m.replace(/%([0-7][0-9a-f])/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
        }
      });
    }
  }
  function list(s) {
    return s
      .split(",")
      .map((a) => {
        return dec(a).trim();
      })
      .filter(Boolean);
  }
  // RFC 6068: "+" is a plus sign (kim+news@…), never a space.
  function parse(href) {
    let raw = href.replace(/^mailto:/i, "");
    let q = raw.indexOf("?");
    let m = { to: list(q < 0 ? raw : raw.slice(0, q)), cc: [], bcc: [], subject: "", body: "" };

    (q < 0 ? "" : raw.slice(q + 1)).split("&").forEach((pair) => {
      let i = pair.indexOf("=");
      let k = dec(i < 0 ? pair : pair.slice(0, i)).toLowerCase();
      let v = i < 0 ? "" : pair.slice(i + 1);

      if (k === "to" || k === "cc" || k === "bcc") m[k] = m[k].concat(list(v));
      else if ((k === "subject" || k === "body") && !m[k]) m[k] = dec(v).replace(/\r\n?/g, "\n");
    });
    return m;
  }
  function query(pairs) {
    return pairs
      .filter((p) => {
        return p[1];
      })
      .map((p) => {
        return p[0] + "=" + encodeURIComponent(p[1]);
      })
      .join("&");
  }
  function links(href) {
    let m = parse(href);
    let to = m.to.join(","), cc = m.cc.join(","), bcc = m.bcc.join(",");
    let outlook = query([["to", to], ["cc", cc], ["bcc", bcc], ["subject", m.subject], ["body", m.body]]);

    return {
      message: m,
      gmail: "https://mail.google.com/mail/?view=cm&fs=1&" + query([["to", to], ["cc", cc], ["bcc", bcc], ["su", m.subject], ["body", m.body]]),
      outlook: "https://outlook.office.com/mail/deeplink/compose?" + outlook,
      "outlook-live": "https://outlook.live.com/mail/0/deeplink/compose?" + outlook,
      app: href,
    };
  }
  w.galleyMailto = { parse: parse, links: links };

  function el(tag, cls, text) {
    let e = d.createElement(tag);

    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function items() {
    return box ? Array.prototype.slice.call(box.querySelectorAll(".galley-mailto__option")) : [];
  }
  function close(refocus) {
    if (!box) return;
    box.remove();
    box = null;
    d.removeEventListener("pointerdown", outside, true);
    d.removeEventListener("focusin", away, true);
    w.removeEventListener("resize", onMove);
    w.removeEventListener("scroll", onMove, true);
    if (refocus && link) link.focus();
    link = null;
  }
  function outside(e) {
    if (box && !box.contains(e.target) && e.target !== link) close(!e.target.closest || !e.target.closest("a,button,input,select,textarea,[tabindex]"));
  }
  function away(e) {
    if (box && !box.contains(e.target)) close(false);
  }
  // The page moved under the dialog: follow the link (a scroll inside the dialog is its own).
  function onMove(e) {
    if (!e || !box || !box.contains(e.target)) place();
  }
  function place() {
    if (!box || !link) return;
    if (w.matchMedia && w.matchMedia("(max-width: 32rem)").matches) {
      box.setAttribute("data-sheet", "");
      box.style.top = box.style.left = "";
      return;
    }
    box.removeAttribute("data-sheet");
    let r = (link.getClientRects()[0] || link.getBoundingClientRect());
    let b = box.getBoundingClientRect();
    let vw = d.documentElement.clientWidth, vh = d.documentElement.clientHeight, gap = 6;
    let top = r.bottom + gap;

    if (top + b.height > vh - 8 && r.top - gap - b.height > 8) top = r.top - gap - b.height;
    box.style.top = Math.max(8, top) + "px";
    box.style.left = Math.max(8, Math.min(r.left, vw - b.width - 8)) + "px";
  }
  function open(a) {
    close(false);
    let href = a.getAttribute("href");
    let all = links(href);
    let address = all.message.to.join(", ");

    if (!styled) {
      styled = true;
      let st = el("style");

      st.textContent = C.css;
      d.head.appendChild(st);
    }
    link = a;
    box = el("div", "galley-mailto");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", (address ? S.label : S.labelNoAddress).replace("{address}", address));
    box.setAttribute("data-galley-mailto", "off");
    if (address) box.appendChild(el("p", "galley-mailto__address", address));
    let ul = el("ul", "galley-mailto__options");
    let status = el("p", "galley-mailto__status");

    status.setAttribute("role", "status");
    C.options.forEach((key) => {
      if (key === "copy" && !address) return;
      let li = el("li");
      let item;

      if (key === "copy") {
        item = el("button", "galley-mailto__option", S.copy);
        item.type = "button";
        item.addEventListener("click", () => {
          let done = (ok) => {
            status.textContent = ok ? S.copied : S.copyFailed;
            setTimeout(() => {
              status.textContent = "";
            }, 2500);
          };

          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(all.message.to.join(", ")).then(() => {
            done(true);
          }, () => {
            done(false);
          });
          else done(false);
        });
      } else if (all[key]) {
        item = el("a", "galley-mailto__option", S[key] || key);
        item.href = all[key];
        if (key !== "app") {
          item.target = "_blank";
          item.rel = "noopener noreferrer";
        }
        item.addEventListener("click", () => {
          setTimeout(() => {
            close(false);
          }, 0);
        });
      } else return;
      item.setAttribute("data-option", key);
      li.appendChild(item);
      ul.appendChild(li);
    });
    let x = el("button", "galley-mailto__close", "×");

    x.type = "button";
    x.setAttribute("aria-label", S.close);
    x.addEventListener("click", () => {
      close(true);
    });
    box.appendChild(ul);
    box.appendChild(status);
    box.appendChild(x);
    box.addEventListener("keydown", (e) => {
      let all = items();
      let i = all.indexOf(d.activeElement);

      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        let n = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;

        all[n].focus();
      }
    });
    d.body.appendChild(box);
    place();
    d.addEventListener("pointerdown", outside, true);
    d.addEventListener("focusin", away, true);
    w.addEventListener("resize", onMove);
    w.addEventListener("scroll", onMove, true);
    let first = items()[0];

    if (first) first.focus();
  }
  function target(e) {
    let a = e.target && e.target.closest ? e.target.closest("a[href]") : null;

    if (!a || !/^mailto:/i.test(a.getAttribute("href")) || a.hasAttribute("download") || a.closest('[data-galley-mailto="off"]')) return null;
    return a;
  }
  d.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    let a = target(e);

    if (!a) return;
    e.preventDefault();
    if (box && link === a) close(true);
    else open(a);
  });
  d.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    let a = target(e);

    if (!a) return;
    e.preventDefault();
    open(a);
  });
}
