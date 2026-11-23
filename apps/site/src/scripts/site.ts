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
