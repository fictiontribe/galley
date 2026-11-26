// The few behaviours the site has. Everything can be read without them.

const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)] as T[];

// Header hairline once the page scrolls.
const header = document.querySelector<HTMLElement>("[data-header]");
if (header) {
  const onScroll = () => header.classList.toggle("is-stuck", scrollY > 4);
  onScroll();
  addEventListener("scroll", onScroll, { passive: true });
}

// Light or dark. The page follows the system until the switch is pressed;
// then the choice is kept (localStorage "galley-theme") and the head script
// in Site.astro applies it before the next first paint. The switch says what
// pressing it does; pictures with a dark twin (<source data-mode-src>) follow.
{
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const easeOff = matchMedia("(prefers-reduced-motion: reduce)");
  const switches = [...document.querySelectorAll<HTMLButtonElement>("[data-mode-switch]")];
  const mode = () => (root.dataset.theme === "dark" || root.dataset.theme === "light" ? root.dataset.theme : system.matches ? "dark" : "light");
  const show = () => {
    const now = mode();
    for (const b of switches) b.setAttribute("aria-label", (now === "dark" ? b.dataset.toLight : b.dataset.toDark) ?? "");
    for (const src of document.querySelectorAll<HTMLSourceElement>("source[data-mode-src]")) {
      if (root.dataset.theme) src.media = now === "dark" ? "all" : "not all";
      const img = src.parentElement?.querySelector("img");
      if (img) img.alt = (now === "dark" ? src.dataset.alt : img.dataset.alt) ?? img.alt;
    }
  };
  const choose = (next: "light" | "dark") => {
    // Colours ease over 200 ms on a switch, never on load, never with less motion asked for.
    if (!easeOff.matches) {
      root.classList.add("mode-easing");
      setTimeout(() => root.classList.remove("mode-easing"), 320);
    }
    root.dataset.theme = next;
    try {
      localStorage.setItem("galley-theme", next);
    } catch {
      /* private mode: the choice lasts for this page */
    }
    document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute("content", next);
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = next === "dark" ? "#16140F" : "#F6F4F0";
    show();
  };
  for (const b of switches) b.addEventListener("click", () => choose(mode() === "dark" ? "light" : "dark"));
  system.addEventListener("change", show);
  show();
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

// Header mega-menus: one open at a time; Escape or a click outside closes them.
const navDropdowns = $$<HTMLDetailsElement>("[data-nav-dd]");
if (navDropdowns.length) {
  for (const dd of navDropdowns) {
    dd.addEventListener("toggle", () => {
      if (!dd.open) return;
      for (const other of navDropdowns) if (other !== dd && other.open) other.open = false;
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = navDropdowns.find((dd) => dd.open);
    if (!open) return;
    open.open = false;
    open.querySelector("summary")?.focus();
  });
  document.addEventListener("click", (e) => {
    for (const dd of navDropdowns) if (dd.open && !dd.contains(e.target as Node)) dd.open = false;
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

// Starters: a look's button swaps the picture. With motion, the new look is
// decoded first, then the two cross-fade (the pictures are stacked in CSS).
for (const card of $$("[data-starter]")) {
  const buttons = $$<HTMLButtonElement>("[data-look-to]", card);
  const imgs = $$<HTMLImageElement>("[data-look]", card);
  const fade = !still && card.closest(".starters--row, .starters--stage, .starters--gallery") !== null;
  if (fade) {
    card.classList.add("is-fading");
    imgs.forEach((img) => img.classList.toggle("is-on", !img.hidden));
  }
  let turn = 0;
  for (const b of buttons) {
    b.addEventListener("click", async () => {
      for (const o of buttons) o.setAttribute("aria-pressed", String(o === b));
      const next = imgs.find((img) => img.dataset.look === b.dataset.lookTo);
      if (!fade || !next) {
        for (const img of imgs) img.hidden = img !== next;
        return;
      }
      const mine = ++turn;
      next.hidden = false;
      next.loading = "eager";
      await next.decode().catch(() => {});
      if (mine !== turn) return;
      for (const img of imgs) img.classList.toggle("is-on", img === next);
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
  // While the map of parts under the hero is in view, the bar would repeat it: it waits, and comes in as the map goes.
  const map = document.querySelector(".tour-map");
  if (map) {
    new IntersectionObserver(([en]) => tourIndex.classList.toggle("is-waiting", en.isIntersecting), { rootMargin: `-${tourIndex.offsetHeight + 68}px 0px 0px 0px` }).observe(map);
  }
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

// The how-to index's filter: a pill leaves only its group's guides. The marker
// slides to the chosen pill; guides that go fade out, the ones that stay glide
// to their new places and the ones that come back rise in. With less motion
// asked for, the list simply changes. The choice is kept in the address
// (/how-to/?show=go-live), so a filtered list can be linked to.
const howtoFilter = document.querySelector<HTMLElement>("[data-howto-filter]");
const howtoCards = document.querySelector<HTMLElement>("[data-howto-cards]");
if (howtoFilter && howtoCards) {
  const pills = $$<HTMLButtonElement>("button[data-group]", howtoFilter);
  const row = pills[0]?.parentElement;
  const thumb = howtoFilter.querySelector<HTMLElement>(".howto-filter__thumb");
  const status = howtoFilter.querySelector<HTMLElement>("[data-howto-status]");
  const cards = $$<HTMLElement>(":scope > li", howtoCards);
  // What sits under the list moves with it when the list gets shorter or longer.
  const after = [...$$("[data-howto-after]"), ...$$("body > footer")];
  const OUT = "cubic-bezier(.16, 1, .3, 1)";
  const IN = "cubic-bezier(.7, 0, .84, 0)";
  let running: Animation[] = [];
  let turn = 0;

  const pressed = () => pills.find((b) => b.getAttribute("aria-pressed") === "true");
  const placeThumb = () => {
    const on = pressed();
    if (!on || !thumb) return;
    thumb.style.setProperty("--x", `${on.offsetLeft}px`);
    thumb.style.setProperty("--w", `${on.offsetWidth}px`);
  };
  const press = (group: string, smooth: boolean) => {
    for (const b of pills) b.setAttribute("aria-pressed", String(b.dataset.group === group));
    placeThumb();
    // Keep the chosen pill in view when the bar scrolls sideways (narrow screens).
    const on = pressed();
    if (on && row && row.scrollWidth > row.clientWidth) {
      const left = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
      row.scrollTo({ left, behavior: smooth && !still ? "smooth" : "auto" });
    }
  };
  // Which way the bar has more pills than fit, for its soft edges.
  const markMore = () => {
    if (!row) return;
    // Past the first pill's edge, or short of the last one's: the bar's own padding doesn't count.
    const first = pills[0];
    const last = pills[pills.length - 1];
    const start = row.scrollLeft > first.offsetLeft + 2;
    const end = row.scrollLeft + row.clientWidth < last.offsetLeft + last.offsetWidth - 2;
    row.dataset.more = start && end ? "both" : start ? "start" : end ? "end" : "";
  };
  row?.addEventListener("scroll", markMore, { passive: true });
  const fits = (card: HTMLElement, group: string) => !group || card.dataset.group === group;
  const say = (n: number) => {
    if (status) status.textContent = (n === 1 ? howtoFilter.dataset.shownOne : howtoFilter.dataset.shown?.replace("{n}", String(n))) ?? "";
  };
  const play = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const a = el.animate(frames, options);
    running.push(a);
    return a;
  };

  const show = async (group: string, animate: boolean) => {
    const mine = ++turn;
    for (const a of running) a.cancel();
    running = [];
    press(group, animate);
    const apply = () => {
      for (const c of cards) c.hidden = !fits(c, group);
    };
    const shown = cards.filter((c) => fits(c, group)).length;
    // No motion when less is asked for, or when nobody is looking: a hidden page doesn't run animations.
    if (!animate || still || document.visibilityState !== "visible") {
      apply();
      if (animate) say(shown);
      return;
    }

    // 1. The guides that go, fade.
    const leaving = cards.filter((c) => !c.hidden && !fits(c, group));
    if (leaving.length) {
      const fades = leaving.map((c) => play(c, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: IN, fill: "forwards" }));
      // The list never waits on a frame that doesn't come (a stalled or hidden page): the fade has 120ms, then the list changes anyway.
      const late = new Promise((done) => setTimeout(done, 280));
      try {
        await Promise.race([Promise.all(fades.map((a) => a.finished)), late]);
      } catch {
        return; // another pill was pressed meanwhile
      }
      if (mine !== turn) return;
    }

    // 2. The list changes; everything still there starts from where it was.
    const staying = cards.filter((c) => !c.hidden && fits(c, group));
    const moved = [...staying, ...after];
    const before = new Map(moved.map((el) => [el, el.getBoundingClientRect()]));
    const bar = howtoFilter.getBoundingClientRect();
    // Scrolled into the list, with the bar holding under the header: the new list starts just under the bar.
    const under = howtoCards.getBoundingClientRect().top < bar.bottom;
    apply();
    for (const a of running) a.cancel();
    running = [];
    say(shown);
    if (under) {
      const gap = parseFloat(getComputedStyle(howtoFilter).marginBottom) || 0;
      scrollTo({ top: scrollY + howtoCards.getBoundingClientRect().top - bar.bottom - gap, behavior: "auto" });
    }
    let entering = 0;
    for (const c of cards) {
      if (c.hidden) continue;
      const from = under ? undefined : before.get(c);
      if (!from) {
        play(c, [{ opacity: 0, translate: "0 12px" }, { opacity: 1, translate: "0 0" }], { duration: 320, easing: OUT, delay: Math.min(entering++, 8) * 30, fill: "backwards" });
        continue;
      }
      const to = c.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) play(c, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 320, easing: OUT });
    }
    if (!under) {
      for (const el of after) {
        const dy = (before.get(el)?.top ?? 0) - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) play(el, [{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration: 320, easing: OUT });
      }
    }
  };

  for (const b of pills) {
    b.addEventListener("click", () => {
      const group = b.dataset.group ?? "";
      if (b.getAttribute("aria-pressed") === "true") return;
      const url = new URL(location.href);
      if (group) url.searchParams.set("show", group);
      else url.searchParams.delete("show");
      history.replaceState(history.state, "", url);
      void show(group, true);
    });
  }

  // A linked-to group opens already filtered.
  const asked = new URLSearchParams(location.search).get("show") ?? "";
  void show(pills.some((b) => b.dataset.group === asked) ? asked : "", false);
  if (row)
    new ResizeObserver(() => {
      placeThumb();
      markMore();
    }).observe(row);
  document.fonts?.ready.then(placeThumb);
  requestAnimationFrame(() => requestAnimationFrame(() => howtoFilter.classList.add("is-ready")));
}

// Downloads: the visitor's own system becomes the one primary button, the
// others a quiet list (without this, every system is listed equally). A Mac
// whose processor the browser won't say is offered Apple silicon, with a
// pointer to the Intel download.
const dlBlocks = $$("[data-dl]");
if (dlBlocks.length) {
  const detect = async (): Promise<{ id: string | null; guessed: boolean }> => {
    const ua = navigator.userAgent;
    const uad = (navigator as Navigator & { userAgentData?: { platform?: string; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
    const plat = uad?.platform ?? navigator.platform ?? "";
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return { id: null, guessed: false };
    if (/Win/i.test(plat) || /Windows/i.test(ua)) return { id: "windows", guessed: false };
    if (/Mac/i.test(plat) || /Macintosh/i.test(ua)) {
      if (navigator.maxTouchPoints > 1) return { id: null, guessed: false }; // an iPad asking for the desktop site
      try {
        const arch = (await uad?.getHighEntropyValues?.(["architecture"]))?.architecture;
        if (arch === "arm") return { id: "mac-arm", guessed: false };
        if (arch === "x86") return { id: "mac-intel", guessed: false };
      } catch {
        /* the browser won't say */
      }
      return { id: "mac-arm", guessed: true };
    }
    if (/Linux|X11/i.test(plat) || /Linux|X11/i.test(ua)) return { id: "linux", guessed: false };
    return { id: null, guessed: false };
  };
  detect().then(({ id, guessed }) => {
    for (const block of dlBlocks) {
      const primary = id ? block.querySelector<HTMLElement>(`[data-dl-for="${id}"]`) : null;
      if (!primary) continue; // not a desktop, or its system isn't available yet: leave the list as it is
      primary.hidden = false;
      block.classList.add("is-picked");
      const hint = primary.querySelector<HTMLElement>("[data-dl-machint]");
      if (hint) hint.hidden = !guessed;
      block.querySelector<HTMLElement>(`[data-dl-row="${id}"]`)?.setAttribute("hidden", "");
      const label = block.querySelector<HTMLElement>("[data-dl-label]");
      if (label?.dataset.picked) label.textContent = label.dataset.picked;
      const fallback = block.querySelector<HTMLElement>("[data-dl-fallback]");
      if (fallback) fallback.hidden = true;
      const other = block.querySelector<HTMLElement>("[data-dl-other]");
      if (other) other.hidden = false;
    }
  });
}

// Motion tied to scroll. CSS does it where the browser has scroll timelines;
// elsewhere this sets the same states from the scroll position, or reveals a
// block once it enters the view. With less motion asked for: nothing moves.
const timelines = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
if (!still && !timelines) {
  document.documentElement.classList.add("rv-js");
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of $$(".rv, .rv-scale")) io.observe(el);
  // The hero's window settles flat over the first 560 px of scroll.
  const canvas = document.querySelector<HTMLElement>("[data-canvas]");
  if (canvas) {
    canvas.classList.add("is-js");
    let queued = false;
    const set = () => {
      queued = false;
      canvas.style.setProperty("--p", String(Math.min(1, Math.max(0, scrollY / 560))));
    };
    set();
    addEventListener("scroll", () => !queued && (queued = requestAnimationFrame(set) > 0), { passive: true });
  }
}

// The story: the step in the middle of the view is marked beside the picture that stays.
for (const story of $$("[data-story]")) {
  const marks = $$("[data-story-mark]", story);
  if (!marks.length) continue;
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const i = (en.target as HTMLElement).dataset.storyStep;
        for (const m of marks) m.classList.toggle("is-on", m.dataset.storyMark === i);
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );
  for (const step of $$("[data-story-step]", story)) io.observe(step);
}
