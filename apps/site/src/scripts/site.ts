// The few behaviours the site has. Everything can be read without them.

const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)] as T[];

// Header hairline once the page scrolls.
const header = document.querySelector<HTMLElement>("[data-header]");
if (header) {
  const onScroll = () => header.classList.toggle("is-stuck", scrollY > 4);
  onScroll();
  addEventListener("scroll", onScroll, { passive: true });
}

// The narrow-screen menu: Escape or a click outside closes it.
const menu = document.querySelector<HTMLDetailsElement>("[data-menu]");
if (menu) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
}

// Tabs: click, arrow keys, Home and End.
for (const list of $$("[data-tabs]")) {
  const tabs = $$<HTMLButtonElement>('[role="tab"]', list);
  const select = (tab: HTMLButtonElement, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute("aria-controls") ?? "");
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const to = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length], true);
    });
  });
}

// Recordings loop while in view, unless the visitor prefers less motion; the
// round button pauses (or plays) them, and a choice made with it is kept.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
for (const box of $$("[data-rec]")) {
  const video = box.querySelector("video");
  const btn = box.querySelector<HTMLButtonElement>("[data-rec-toggle]");
  if (!video || !btn) continue;
  let held = still;
  const show = (paused: boolean) => {
    box.classList.toggle("is-paused", paused);
    btn.setAttribute("aria-label", (paused ? btn.dataset.play : btn.dataset.pause) ?? "");
  };
  show(true);
  btn.hidden = false;
  btn.addEventListener("click", () => {
    held = !video.paused;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  video.addEventListener("play", () => show(false));
  video.addEventListener("pause", () => show(true));
  new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !held) video.play().catch(() => {});
    else if (!en.isIntersecting && !video.paused) video.pause();
  }, { threshold: 0.3 }).observe(box);
}

// Starters: a look's button swaps the picture.
for (const card of $$("[data-starter]")) {
  const buttons = $$<HTMLButtonElement>("[data-look-to]", card);
  for (const b of buttons) {
    b.addEventListener("click", () => {
      for (const o of buttons) o.setAttribute("aria-pressed", String(o === b));
      for (const img of $$<HTMLImageElement>("[data-look]", card)) img.hidden = img.dataset.look !== b.dataset.lookTo;
    });
  }
}

// Copy a command, a code block, or a whole file this site serves.
const copy = async (btn: HTMLElement, text: Promise<string> | string) => {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(await text);
    btn.textContent = btn.dataset.done ?? document.documentElement.dataset.copied ?? "";
  } catch {
    btn.textContent = document.documentElement.dataset.copyFailed ?? label;
  }
  setTimeout(() => (btn.textContent = label), 1800);
};
document.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest<HTMLElement>("[data-copy], [data-copy-text], [data-copy-file]");
  if (!btn) return;
  if (btn.dataset.copyFile) copy(btn, fetch(btn.dataset.copyFile).then((r) => r.text()));
  else copy(btn, btn.dataset.copy ?? btn.dataset.copyText ?? "");
});
for (const b of $$("[data-copy], [data-copy-text]")) b.hidden = false;

// The example proof: Put back restores a change's old words, as in the app.
for (const sheet of $$("[data-sheet]")) {
  const count = sheet.querySelector("[data-count]");
  sheet.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".change__act");
    if (!btn) return;
    const kept = btn.closest(".change")!.classList.toggle("is-kept");
    btn.textContent = (kept ? sheet.dataset.undo : sheet.dataset.put) ?? "";
    const n = $$(".change:not(.is-kept)", sheet).length;
    if (count) count.textContent = n === 1 ? sheet.dataset.one ?? "" : (sheet.dataset.many ?? "").replace("{n}", String(n));
  });
}

// The film: chapters jump to a point in it.
for (const film of $$("[data-film]")) {
  const video = film.querySelector("video");
  for (const b of $$<HTMLButtonElement>("[data-film-seek]", film)) {
    b.addEventListener("click", () => {
      if (!video) return;
      video.currentTime = Number(b.dataset.filmSeek);
      video.play().catch(() => {});
    });
  }
}

// A file this site serves (a page's markdown twin, llms.txt), shown as it is.
for (const pre of $$("[data-fetch-file]")) {
  fetch(pre.dataset.fetchFile!)
    .then((r) => (r.ok ? r.text() : Promise.reject()))
    .then((text) => (pre.textContent = text.split("\n").slice(0, 60).join("\n")))
    .catch(() => {});
}

// See a capture full size: the corner control (a plain link without
// JavaScript) or a click on the panel's pictures opens the page's one native
// <dialog>; ← → move between the panel's pictures, Escape or Close shuts it,
// and focus goes back to where it was.
const lightbox = document.querySelector<HTMLDialogElement>("[data-lightbox]");
if (lightbox && typeof lightbox.showModal === "function") {
  interface Zoomed { src: string; w: number; h: number; alt: string }
  const img = lightbox.querySelector<HTMLImageElement>("[data-lb-img]")!;
  const cap = lightbox.querySelector<HTMLElement>("[data-lb-cap]")!;
  const prev = lightbox.querySelector<HTMLButtonElement>("[data-lb-prev]")!;
  const next = lightbox.querySelector<HTMLButtonElement>("[data-lb-next]")!;
  const closeBtn = lightbox.querySelector<HTMLButtonElement>("[data-lb-close]")!;
  let items: Zoomed[] = [];
  let at = 0;
  let label = "";
  let back: HTMLElement | null = null;
  const pic = img.parentElement!;
  // True size, made smaller only to fit the window; below 1024 px always true size, to pan across.
  const fit = () => {
    const it = items[at];
    if (!it) return;
    const scale = innerWidth < 1024 ? 1 : Math.min(1, pic.clientWidth / it.w, pic.clientHeight / it.h);
    img.style.width = `${Math.round(it.w * scale)}px`;
    img.style.height = `${Math.round(it.h * scale)}px`;
  };
  addEventListener("resize", () => lightbox.open && fit());
  const show = (i: number) => {
    at = (i + items.length) % items.length;
    const it = items[at];
    img.removeAttribute("src");
    img.width = it.w;
    img.height = it.h;
    img.alt = it.alt;
    img.src = it.src;
    fit();
    pic.scrollTo(0, 0);
    cap.textContent = label;
    if (items.length > 1) {
      const count = document.createElement("span");
      count.textContent = (lightbox.dataset.of ?? "{n} of {total}").replace("{n}", String(at + 1)).replace("{total}", String(items.length));
      cap.append(count);
    }
    prev.hidden = next.hidden = items.length < 2;
  };
  const open = (control: HTMLElement, i = 0) => {
    try {
      items = JSON.parse(control.dataset.zoom ?? "[]");
    } catch {
      items = [];
    }
    if (!items.length) return false;
    label = control.dataset.zoomLabel ?? "";
    back = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : control;
    lightbox.showModal();
    show(Math.min(i, items.length - 1));
    closeBtn.focus();
    return true;
  };
  for (const panel of $$("[data-zoom-panel]")) {
    const control = panel.querySelector<HTMLElement>("[data-zoom]");
    if (!control) continue;
    panel.classList.add("is-zoomable");
    control.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (open(control)) e.preventDefault();
    });
    panel.addEventListener("click", (e) => {
      const hit = (e.target as Element).closest<HTMLElement>("[data-zoom-at]");
      if (!hit || !panel.contains(hit)) return;
      open(control, Number(hit.dataset.zoomAt));
      back = control;
    });
  }
  prev.addEventListener("click", () => show(at - 1));
  next.addEventListener("click", () => show(at + 1));
  closeBtn.addEventListener("click", () => lightbox.close());
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox || (e.target as Element).classList.contains("lightbox__pic")) lightbox.close();
  });
  lightbox.addEventListener("keydown", (e) => {
    if (items.length < 2) return;
    if (e.key === "ArrowLeft") show(at - 1);
    else if (e.key === "ArrowRight") show(at + 1);
  });
  lightbox.addEventListener("close", () => {
    img.removeAttribute("src");
    back?.focus({ preventScroll: true });
  });
}

// The tour's index marks the part in view.
const tourIndex = document.querySelector<HTMLElement>("[data-tour-index]");
if (tourIndex) {
  const links = $$<HTMLAnchorElement>("a[href^='#']", tourIndex);
  const list = tourIndex.querySelector<HTMLElement>("ol");
  const mark = (id: string | null) => {
    for (const a of links) {
      const on = a.getAttribute("href") === `#${id}`;
      if (on) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
      // Keep the marked part in view in the index when it scrolls sideways (narrow screens).
      if (on && list && list.scrollWidth > list.clientWidth) list.scrollTo({ left: a.offsetLeft - 12, behavior: still ? "auto" : "smooth" });
    }
  };
  const parts = $$("[data-tour-part]");
  const inView = new Set<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) inView.add(en.target);
        else inView.delete(en.target);
      }
      const first = parts.find((p) => inView.has(p));
      mark(first ? first.id : null);
    },
    { rootMargin: "-30% 0px -60% 0px" },
  );
  for (const p of parts) io.observe(p);
}
