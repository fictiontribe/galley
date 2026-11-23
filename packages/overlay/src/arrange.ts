/**
 * Arrange mode: the page's sections, outlined and handled on the page itself.
 *
 * All chrome lives in one shadow root on a fixed, pointer-transparent layer
 * outside <body>, so it never moves the page's layout or catches its
 * scrolling; only the buttons take the pointer. The overlay never edits
 * anything: every action is a request to the host (`arrange-action`,
 * `place`), which turns it into an edit of the content file. The host is the
 * truth for the selection and for whether the page is up to date
 * (`settling`); after each edit the chrome waits until the page matches the
 * content again.
 *
 * A new section is placed from the host's palette: the host says it is
 * `placing`, then either reports its pointer over this frame (a drag that
 * started in the app — the app keeps the pointer, this frame only does the
 * geometry) or waits for a click on one of the insertion lines here.
 */
import type { HostToOverlay, OverlayToHost } from "@galley/core/types";
import { arrangeCss } from "./arrange-styles";
import { edgeSpeed, gapAt, gapY, moveTo, nearGap, type Span } from "./geometry";
import { mapSections, type MappedSection, type SectionMap } from "./sections";
import { DRAGGING_CLASS, LIFTED_CLASS, ROOM_PX, ROOT_ATTR, SHIFTED_CLASS, type Appearance } from "./styles";

type Outgoing = OverlayToHost extends infer M ? (M extends { galley: 1 } ? Omit<M, "galley"> : never) : never;
export type ArrangeState = Extract<HostToOverlay, { type: "arrange" }>;

export interface Arrange {
  update(state: ArrangeState): void;
  placing(field: string | null, label: string | null): void;
  pointer(point: { x: number; y: number } | null): void;
  drop(): void;
  appearance(look: Appearance): void;
  /** Whether Arrange mode is on (click to edit stays off meanwhile). */
  readonly on: boolean;
  dispose(): void;
}

/** How long a page that doesn't match its content is given to catch up (a reload) before arranging is declined. */
export const GRACE_MS = 2500;
const REMAP_MS = 120;
const REMAP_MAX_MS = 700;
const PENDING_MS = 4000;
/** Session key: the person was working from the keyboard when the page reloaded, so focus goes back to the selection. */
const FOCUS_KEY = "galley:arrange-focus";

const ICONS = {
  grip: '<circle cx="6" cy="4" r=".9"/><circle cx="10" cy="4" r=".9"/><circle cx="6" cy="8" r=".9"/><circle cx="10" cy="8" r=".9"/><circle cx="6" cy="12" r=".9"/><circle cx="10" cy="12" r=".9"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  copy: '<path d="M5.5 5.5h7v8h-7zM3.5 10.5v-8h7"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>',
  caret: '<path d="M2.1 13.9 8 4.3l5.9 9.6"/>',
} as const;
const svg = (name: keyof typeof ICONS) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;

interface Drag {
  pointerId: number;
  field: string;
  from: number;
  label: string;
  spans: Span[];
  roots: Element[];
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  gap: number | null;
}

export function createArrange(win: Window, send: (message: Outgoing) => void): Arrange {
  const doc = win.document;
  let state: ArrangeState | null = null;
  let on = false;
  let map: SectionMap | null = null;
  let mapped: MappedSection[] = [];
  let reported = "";
  let listsAt = 0;
  let selected: string | null = null;
  let focusShown = false;
  let pointerAt = 0;
  let pointer: { x: number; y: number; target: EventTarget | null } | null = null;
  let placing: { field: string; label: string } | null = null;
  let placingPoint: { x: number; y: number } | null = null;
  let placingGap: number | null = null;
  let drag: Drag | null = null;
  /** An edit was asked for; the chrome waits for the host to take it from here. */
  let pendingUntil = 0;
  let lastSpoken: { key: string; label: string; index: number } | null = null;
  /** Focus was on a section (or its toolbar) when an edit was asked for: give it back once the page shows the edit. */
  let keepFocus = (() => {
    try {
      const kept = win.sessionStorage.getItem(FOCUS_KEY) === "1";
      win.sessionStorage.removeItem(FOCUS_KEY);
      return kept;
    } catch {
      return false;
    }
  })();
  const focusedHere = () => doc.activeElement === host || mapped.some((item) => item.element === doc.activeElement);
  const tabindex = new Map<Element, string | null>();
  const marked = new Set<Element>();
  const timers: { remap?: ReturnType<typeof setTimeout>; grace?: ReturnType<typeof setTimeout>; firstMutation: number } = { firstMutation: 0 };
  let frame = 0;
  let scrollFrame = 0;

  // ── the layer
  const host = doc.createElement("div");
  host.setAttribute("data-galley-arrange", "");
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = arrangeCss();
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ""): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    element.className = className;
    if (html) element.innerHTML = html;
    return element;
  };
  const hoverBox = make("div", "box hover");
  const hoverTab = make("span", "tab");
  hoverBox.append(hoverTab);
  const selBox = make("div", "box sel");
  const selTab = make("span", "tab");
  selBox.append(selTab);
  const bar = make("div", "bar");
  bar.setAttribute("role", "toolbar");
  const button = (act: string, label: string, html: string, extra = "") => {
    const element = make("button", extra, html);
    element.type = "button";
    element.dataset.act = act;
    element.setAttribute("aria-label", label);
    element.title = label;
    return element;
  };
  const grip = button("grip", "Drag to move", svg("grip"), "grip");
  grip.tabIndex = -1;
  const upButton = button("up", "Move up", svg("up"));
  const downButton = button("down", "Move down", svg("down"));
  const copyButton = button("duplicate", "Duplicate", svg("copy"));
  const removeButton = button("remove", "Remove", svg("trash"), "danger");
  const optionsButton = button("options", "Options", "Options", "text");
  const editButton = button("edit", "Edit content", "Edit content", "text");
  const sep = make("span", "sep");
  bar.append(grip, upButton, downButton, copyButton, removeButton, sep, optionsButton, editButton);
  const gapLayer = make("div", "");
  const dropLine = make("div", "drop", `<span class="line"></span><span class="caret">${svg("caret")}</span><span class="label"></span>`);
  const ghost = make("div", "ghost");
  const note = make("div", "note", '<span class="dots"><b></b><b></b><b></b></span><span>Updating the page…</span>');
  const live = make("div", "sr");
  live.setAttribute("aria-live", "polite");
  shadow.append(style, hoverBox, selBox, gapLayer, dropLine, ghost, bar, note, live);
  for (const element of [hoverBox, selBox, dropLine, ghost, bar, note]) element.hidden = true;
  doc.documentElement.appendChild(host);

  const gapPool: HTMLDivElement[] = [];

  // ── reading the page
  const usable = () => on && map !== null && map.ok && !waiting();
  const waiting = () => Boolean(state?.settling) || Date.now() < pendingUntil;
  const editable = () => Boolean(state?.editable);
  const byKey = (key: string | null) => (key ? (mapped.find((section) => section.key === key) ?? null) : null);
  const sectionAt = (target: EventTarget | null): MappedSection | null => {
    if (!target || target === host || (target as Node).nodeType !== 1) return null;
    return mapped.find((section) => section.element.contains(target as Node)) ?? null;
  };
  const fieldSections = (field: string) => mapped.filter((section) => section.field === field);
  const spansOf = (field: string): Span[] =>
    fieldSections(field).map((section) => {
      const box = section.element.getBoundingClientRect();
      return { top: box.top + win.scrollY, bottom: box.bottom + win.scrollY };
    });
  const countOf = (field: string) => state?.lists.find((list) => list.field === field)?.sections.length ?? 0;

  const say = (text: string) => {
    live.textContent = "";
    setTimeout(() => {
      live.textContent = text;
    }, 30);
  };

  const clearMarks = () => {
    for (const element of marked) element.classList.remove(LIFTED_CLASS, SHIFTED_CLASS);
    marked.clear();
    doc.documentElement.classList.remove(DRAGGING_CLASS);
  };
  const releaseRoots = (keep: ReadonlySet<Element> = new Set()) => {
    for (const [element, value] of tabindex) {
      if (keep.has(element)) continue;
      element.removeAttribute(ROOT_ATTR);
      if (value === null) element.removeAttribute("tabindex");
      else element.setAttribute("tabindex", value);
      tabindex.delete(element);
    }
  };
  /** One tab stop for the sections: the selected one, else the first. */
  const rovingTabs = () => {
    const current = byKey(selected) ?? mapped[0];
    for (const section of mapped) section.element.setAttribute("tabindex", section === current ? "0" : "-1");
  };

  const report = () => {
    if (!state || !on || !map) return;
    let status: "mapped" | "waiting" | "declined" = "mapped";
    if (!map.ok) {
      const settlingNow = waiting() || Date.now() - listsAt < GRACE_MS;
      status = settlingNow ? "waiting" : "declined";
      if (settlingNow) {
        if (timers.grace) clearTimeout(timers.grace);
        timers.grace = setTimeout(remap, Math.max(60, Math.min(GRACE_MS, listsAt + GRACE_MS - Date.now()) + 20));
      }
    }
    const message = {
      type: "arrange-status" as const,
      status,
      how: map.ok ? map.how : null,
      reason: map.ok ? null : map.reason,
      revision: state.revision,
    };
    const signature = JSON.stringify(message);
    if (signature === reported) return;
    reported = signature;
    send(message);
  };

  function remap(): void {
    if (timers.remap) clearTimeout(timers.remap);
    timers.remap = undefined;
    timers.firstMutation = 0;
    if (!state || !on) return;
    clearMarks();
    map = mapSections(doc, state.lists);
    mapped = map.ok ? map.sections : [];
    const roots = new Set(mapped.map((section) => section.element));
    releaseRoots(roots);
    for (const section of mapped) {
      if (!tabindex.has(section.element)) tabindex.set(section.element, section.element.getAttribute("tabindex"));
      section.element.setAttribute(ROOT_ATTR, "");
    }
    rovingTabs();
    report();
    paint();
  }
  const scheduleRemap = () => {
    const now = Date.now();
    if (!timers.firstMutation) timers.firstMutation = now;
    if (timers.remap) clearTimeout(timers.remap);
    // Re-map once the page settles, but never wait longer than REMAP_MAX_MS while it keeps changing.
    timers.remap = setTimeout(remap, Math.max(0, Math.min(REMAP_MS, timers.firstMutation + REMAP_MAX_MS - now)));
  };
  const observer = typeof MutationObserver === "function" ? new MutationObserver(scheduleRemap) : null;

  // ── painting (one frame at a time)
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(paint);
  };
  const place = (element: HTMLElement, x: number, y: number) => {
    element.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  };
  /**
   * Whether a fixed or sticky part of the page — a site's sticky header —
   * covers the point. Chrome drawn there would sit on top of the site's own
   * header, so it moves inside the section's box instead. The layer itself is
   * pointer-transparent, so hit-testing sees the page underneath it.
   */
  const coveredAt = (x: number, y: number, section: Element): boolean => {
    const doc = win.document;
    const hit = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(Math.max(0, x), Math.max(0, y)) : null;
    for (let node: Element | null = hit; node && node !== doc.documentElement && node !== doc.body; node = node.parentElement) {
      if (node === section || section.contains(node)) return false;
      const position = win.getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return false;
  };
  const frameBox = (box: HTMLElement, tab: HTMLElement, rect: DOMRect, text: string, section: Element) => {
    box.hidden = false;
    place(box, rect.left, rect.top);
    box.style.width = `${Math.round(rect.width)}px`;
    box.style.height = `${Math.round(rect.height)}px`;
    tab.innerHTML = text;
    // Above the box when there is room and nothing of the page's own sits there; inside it otherwise.
    tab.classList.toggle("inside", rect.top < 22 || coveredAt(rect.left + 12, rect.top - 11, section));
  };
  const gapElement = (at: number): HTMLDivElement => {
    let element = gapPool[at];
    if (!element) {
      element = make("div", "gap", '<span class="line"></span>');
      const add = make("button", "add");
      add.type = "button";
      add.dataset.act = "gap";
      element.append(add);
      gapPool[at] = element;
      gapLayer.append(element);
    }
    return element;
  };
  const labelAt = (field: string, gap: number) => {
    const sections = fieldSections(field);
    if (sections.length === 0) return "here";
    if (gap === 0) return "at the top";
    if (gap >= sections.length) return "at the end";
    return `after “${(sections[gap - 1] as MappedSection).label}”`;
  };

  function paint(): void {
    frame = 0;
    const show = usable();
    host.hidden = !on;
    note.hidden = !(on && map !== null && (map.ok || waiting()) && waiting());
    if (!show) {
      for (const element of [hoverBox, selBox, bar, dropLine, ghost]) element.hidden = true;
      // The pool is filled by gap index, so it has holes: forEach skips them, for…of would not.
      gapPool.forEach((element) => {
        element.hidden = true;
      });
      return;
    }
    const current = byKey(selected);
    // Hovered section (not the selected one): a quiet outline and its label.
    const hovered = pointer && !drag ? sectionAt(pointer.target) : null;
    if (hovered && hovered !== current && !placing) frameBox(hoverBox, hoverTab, hovered.element.getBoundingClientRect(), escape(hovered.label), hovered.element);
    else hoverBox.hidden = true;

    if (current && !placing) {
      const rect = current.element.getBoundingClientRect();
      frameBox(selBox, selTab, rect, `${escape(current.label)} <i>${current.index + 1}/${countOf(current.field)}</i>`, current.element);
      selBox.classList.toggle("focus", focusShown);
      bar.hidden = Boolean(drag?.started);
      if (!bar.hidden) {
        const canEdit = editable();
        for (const element of [grip, upButton, downButton, copyButton, removeButton, sep, optionsButton]) element.hidden = !canEdit;
        upButton.disabled = current.index === 0;
        downButton.disabled = current.index >= countOf(current.field) - 1;
        bar.setAttribute("aria-label", `${current.label}, section ${current.index + 1} of ${countOf(current.field)}`);
        const width = bar.offsetWidth || 320;
        const x = Math.max(4, Math.min(rect.right - width, win.innerWidth - width - 4));
        // The toolbar follows the same rule as the tab: never on top of a sticky header.
        const top = rect.top - 36 >= 4 && !coveredAt(x + width / 2, rect.top - 18, current.element) ? rect.top - 36 : Math.max(rect.top, 0) + 26;
        place(bar, x, Math.min(top, Math.max(4, rect.bottom - 34)));
      }
    } else {
      selBox.hidden = true;
      bar.hidden = true;
    }

    // Insertion lines: every gap while placing, else the one under the pointer.
    const scrollY = win.scrollY;
    let shown: { field: string; gaps: number[]; hot: number | null } | null = null;
    if (placing) shown = { field: placing.field, gaps: [...Array(fieldSections(placing.field).length + 1).keys()], hot: placingGap };
    else if (pointer && !drag && editable()) {
      const field = (sectionAt(pointer.target) ?? current ?? mapped[0])?.field;
      if (field) {
        const near = nearGap(spansOf(field), pointer.y + scrollY, 20);
        if (near !== null) shown = { field, gaps: [near], hot: null };
      }
    }
    const visible = new Set(shown?.gaps ?? []);
    gapPool.forEach((element, at) => {
      if (!visible.has(at)) element.hidden = true;
    });
    if (shown) {
      const spans = spansOf(shown.field);
      const sections = fieldSections(shown.field);
      const left = Math.min(...sections.map((section) => section.element.getBoundingClientRect().left));
      const right = Math.max(...sections.map((section) => section.element.getBoundingClientRect().right));
      for (const at of shown.gaps) {
        const element = gapElement(at);
        element.hidden = shown.hot === at;
        element.classList.toggle("wide", Boolean(placing));
        place(element, Math.max(0, left), gapY(spans, at) - scrollY);
        element.style.width = `${Math.round(Math.min(right, win.innerWidth) - Math.max(0, left))}px`;
        const add = element.lastElementChild as HTMLButtonElement;
        const where = labelAt(shown.field, at);
        add.textContent = placing ? `+ Add ${where}` : "+";
        add.setAttribute("aria-label", placing ? `Add ${placing.label} ${where}` : `Add a section ${where}`);
        add.dataset.field = shown.field;
        add.dataset.gap = String(at);
      }
    }

    // The drop line: where a dragged (or placed) section will land.
    const target = drag?.started ? { field: drag.field, gap: drag.gap, spans: drag.spans, still: drag.gap === null || moveTo(drag.from, drag.gap) === null, text: "Move here" } : placing && placingGap !== null ? { field: placing.field, gap: placingGap, spans: spansOf(placing.field), still: false, text: `Add ${placing.label} here` } : null;
    if (target && target.gap !== null) {
      const room = drag && !target.still && target.gap < target.spans.length ? ROOM_PX / 2 : 0;
      const sections = fieldSections(target.field);
      const box = sections[0]?.element.getBoundingClientRect();
      dropLine.hidden = false;
      dropLine.classList.toggle("still", target.still);
      place(dropLine, Math.max(0, box?.left ?? 0), gapY(target.spans, target.gap) - scrollY + room);
      dropLine.style.width = `${Math.round(Math.min(box?.width ?? win.innerWidth, win.innerWidth))}px`;
      (dropLine.lastElementChild as HTMLElement).textContent = target.still ? "Stays here" : target.text;
    } else dropLine.hidden = true;

    if (drag?.started) {
      ghost.hidden = false;
      ghost.innerHTML = `${svg("grip")}${escape(drag.label)}`;
      place(ghost, drag.x + 14, drag.y + 10);
    } else ghost.hidden = true;
  }

  // ── selection
  const speak = (section: MappedSection) => {
    const total = countOf(section.field);
    const before = lastSpoken;
    lastSpoken = { key: section.key, label: section.label, index: section.index };
    if (before && before.label === section.label && before.index !== section.index && before.key !== section.key) {
      say(`${section.label} moved to ${section.index + 1} of ${total}.`);
      return;
    }
    say(`${section.label}, section ${section.index + 1} of ${total}.${editable() ? " Alt and arrow keys move it, Delete removes it, Enter edits its content." : " Enter edits its content."}`);
  };
  const select = (section: MappedSection | null, how: "pointer" | "keyboard") => {
    selected = section?.key ?? null;
    focusShown = how === "keyboard";
    send({ type: "arrange-select", key: selected });
    rovingTabs();
    if (section) {
      speak(section);
      if (how === "keyboard" && doc.activeElement !== section.element) (section.element as HTMLElement).focus({ preventScroll: true });
      if (how === "keyboard") section.element.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    }
    schedule();
  };
  const reducedMotion = () => Boolean(win.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  const ask = (request: Extract<Outgoing, { type: "arrange-action" }>, waits: boolean) => {
    if (waits && focusedHere()) keepFocus = true;
    if (waits) {
      pendingUntil = Date.now() + PENDING_MS;
      setTimeout(() => {
        report();
        schedule();
      }, PENDING_MS + 20);
    }
    send(request);
    schedule();
  };
  const act = (action: string, section: MappedSection) => {
    const { field, index } = section;
    switch (action) {
      case "up":
      case "down":
        if (!editable()) return;
        if ((action === "up" && index === 0) || (action === "down" && index >= countOf(field) - 1)) return;
        say(`Moving ${section.label} ${action}…`);
        ask({ type: "arrange-action", action: "step", field, index, delta: action === "up" ? -1 : 1 }, true);
        return;
      case "duplicate":
      case "remove":
        if (!editable()) return;
        ask({ type: "arrange-action", action, field, index }, true);
        return;
      case "options":
      case "edit":
        ask({ type: "arrange-action", action, field, index }, false);
    }
  };

  // ── pointer
  const onPointerMove = (event: PointerEvent) => {
    if (!usable() || drag) return;
    pointer = { x: event.clientX, y: event.clientY, target: event.target };
    schedule();
  };
  const onPointerDown = () => {
    pointerAt = Date.now();
  };
  const onLeave = () => {
    pointer = null;
    schedule();
  };
  const onClick = (event: MouseEvent) => {
    if (!on || event.target === host) return;
    const section = usable() ? sectionAt(event.target) : null;
    // Links and buttons inside sections don't act while arranging; the site's header and footer still navigate.
    if (!section) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (placing) return;
    select(section, "pointer");
  };

  const startDrag = (event: PointerEvent) => {
    const section = byKey(selected);
    if (!section || !editable() || event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture?.(event.pointerId);
    const roots = fieldSections(section.field).map((item) => item.element);
    drag = { pointerId: event.pointerId, field: section.field, from: section.index, label: section.label, spans: [], roots, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, started: false, gap: null };
  };
  /** Scroll by `speed` px per 60th of a second, whatever the frame rate, ignoring the site's smooth scrolling. */
  let tickAt = 0;
  const edgeScroll = (y: number): boolean => {
    const now = win.performance.now();
    const elapsed = tickAt ? Math.min(64, now - tickAt) : 16.7;
    tickAt = now;
    const speed = edgeSpeed(y, win.innerHeight);
    if (speed === 0) return false;
    win.scrollTo({ top: win.scrollY + (speed * elapsed) / 16.7, left: win.scrollX, behavior: "instant" });
    return true;
  };
  const dragTick = () => {
    if (!drag?.started) return;
    edgeScroll(drag.y);
    const gap = gapAt(drag.spans, drag.y + win.scrollY);
    if (gap !== drag.gap) {
      drag.gap = gap;
      const moving = moveTo(drag.from, gap) !== null;
      drag.roots.forEach((element, at) => {
        const shift = moving && at !== drag?.from && at >= gap;
        element.classList.toggle(SHIFTED_CLASS, shift);
        if (shift) marked.add(element);
      });
    }
    paint();
    scrollFrame = win.requestAnimationFrame(dragTick);
  };
  const onGripMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 3) {
      drag.started = true;
      // Measured once: sections move aside while dragging, so their boxes can't be re-read.
      drag.spans = drag.roots.map((element) => {
        const box = element.getBoundingClientRect();
        return { top: box.top + win.scrollY, bottom: box.bottom + win.scrollY };
      });
      const lifted = drag.roots[drag.from];
      lifted?.classList.add(LIFTED_CLASS);
      if (lifted) marked.add(lifted);
      doc.documentElement.classList.add(DRAGGING_CLASS);
      say(`Dragging ${drag.label}. Release to drop it, or press Escape to leave it where it was.`);
      tickAt = 0;
      scrollFrame = win.requestAnimationFrame(dragTick);
    }
  };
  const endDrag = (commit: boolean) => {
    const ended = drag;
    drag = null;
    win.cancelAnimationFrame(scrollFrame);
    if (!ended) return;
    const to = ended.started && ended.gap !== null ? moveTo(ended.from, ended.gap) : null;
    if (commit && to !== null) {
      // The page keeps the room it made until it reloads in the new order.
      ask({ type: "arrange-action", action: "move", field: ended.field, index: ended.from, to }, true);
      return;
    }
    clearMarks();
    if (ended.started) say(`${ended.label} stays where it was.`);
    schedule();
  };
  const onGripUp = (event: PointerEvent) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(true);
  };
  const onGripCancel = () => endDrag(false);

  const onShadowClick = (event: MouseEvent) => {
    const target = (event.target as Element).closest?.("button");
    if (!target) return;
    const name = target.dataset.act;
    if (name === "gap") {
      const field = target.dataset.field ?? "";
      const gap = Number(target.dataset.gap);
      if (placing) send({ type: "place", field, index: gap });
      else ask({ type: "arrange-action", action: "add", field, index: gap }, false);
      return;
    }
    const section = byKey(selected);
    if (section && name && name !== "grip") act(name, section);
  };

  // ── keyboard
  const order = () => mapped;
  const onKeyDown = (event: KeyboardEvent) => {
    if (!on) return;
    if (drag && event.key === "Escape") {
      event.preventDefault();
      endDrag(false);
      return;
    }
    if (!usable()) return;
    const active = doc.activeElement;
    const section = mapped.find((item) => item.element === active) ?? null;
    const inBar = active === host && bar.contains(shadow.activeElement);
    const mod = event.metaKey || event.ctrlKey;
    if (section) {
      const at = order().indexOf(section);
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey && !mod) {
        const next = order()[at + (event.key === "ArrowDown" ? 1 : -1)];
        event.preventDefault();
        if (next) select(next, "keyboard");
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.altKey) {
        event.preventDefault();
        act(event.key === "ArrowUp" ? "up" : "down", section);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        act("remove", section);
      } else if (event.key === "Enter") {
        event.preventDefault();
        act("edit", section);
      } else if (event.key === "Escape") {
        event.preventDefault();
        select(null, "keyboard");
      } else if (event.key === "Tab" && !event.shiftKey) {
        const first = [...bar.querySelectorAll("button")].find((element) => !element.hidden && !element.disabled && element.tabIndex >= 0);
        if (selected === section.key && first) {
          event.preventDefault();
          first.focus();
        }
      } else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey && editable()) {
        event.preventDefault();
        ask({ type: "arrange-action", action: "undo", field: section.field, index: section.index }, true);
      }
      return;
    }
    if (inBar) {
      const current = byKey(selected);
      const buttons = [...bar.querySelectorAll("button")].filter((element) => !element.hidden && !element.disabled && element.tabIndex >= 0);
      const at = buttons.indexOf(shadow.activeElement as HTMLButtonElement);
      if (event.key === "Escape" || (event.key === "Tab" && event.shiftKey && at === 0)) {
        event.preventDefault();
        (current?.element as HTMLElement | undefined)?.focus({ preventScroll: true });
      } else if (event.key === "Tab" && !event.shiftKey && at === buttons.length - 1 && current) {
        const next = order()[order().indexOf(current) + 1];
        if (next) {
          event.preventDefault();
          select(next, "keyboard");
        }
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        buttons[(at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!usable()) return;
    const target = event.target as Element | null;
    if (!target || target === host) return;
    const root = mapped.find((item) => item.element === target);
    const keyboard = Date.now() - pointerAt > 400;
    if (root) {
      if (selected !== root.key) select(root, keyboard ? "keyboard" : "pointer");
      else {
        focusShown = keyboard;
        schedule();
      }
      return;
    }
    // Focus that lands inside a section (a link, a button) goes to the section: arranging, not following links.
    const inside = sectionAt(target);
    if (inside) (inside.element as HTMLElement).focus({ preventScroll: true });
  };
  const onFocusOut = () => {
    setTimeout(() => {
      const active = doc.activeElement;
      if (active !== host && !mapped.some((item) => item.element === active)) {
        focusShown = false;
        schedule();
      }
    }, 0);
  };

  // ── placing a new section from the host
  const placingTick = () => {
    if (!placing || !placingPoint) return;
    if (edgeScroll(placingPoint.y)) updatePlacingGap();
    scrollFrame = win.requestAnimationFrame(placingTick);
  };
  const updatePlacingGap = () => {
    if (!placing) return;
    const gap = placingPoint && usable() ? gapAt(spansOf(placing.field), placingPoint.y + win.scrollY) : null;
    if (gap !== placingGap) {
      placingGap = gap;
      send({ type: "placing-at", field: gap === null ? null : placing.field, index: gap });
    }
    schedule();
  };

  const onPageHide = () => {
    if (!keepFocus && !focusedHere()) return;
    try {
      win.sessionStorage.setItem(FOCUS_KEY, "1");
    } catch {
      // No storage: focus stays wherever the browser puts it.
    }
  };
  const listen = (enable: boolean) => {
    const method = enable ? "addEventListener" : "removeEventListener";
    doc[method]("pointermove", onPointerMove as EventListener, { capture: true, passive: true } as AddEventListenerOptions);
    doc[method]("pointerdown", onPointerDown, true);
    doc.documentElement[method]("pointerleave", onLeave);
    win[method]("click", onClick as EventListener, true);
    win[method]("keydown", onKeyDown as EventListener, true);
    doc[method]("focusin", onFocusIn as EventListener, true);
    doc[method]("focusout", onFocusOut, true);
    win[method]("scroll", schedule, { passive: true } as AddEventListenerOptions);
    win[method]("resize", schedule);
    win[method]("pagehide", onPageHide);
  };
  shadow.addEventListener("click", onShadowClick as EventListener);
  grip.addEventListener("pointerdown", startDrag);
  grip.addEventListener("pointermove", onGripMove);
  grip.addEventListener("pointerup", onGripUp);
  grip.addEventListener("pointercancel", onGripCancel);
  grip.addEventListener("lostpointercapture", () => {
    if (drag) endDrag(true);
  });

  const turnOff = () => {
    on = false;
    listen(false);
    observer?.disconnect();
    endDrag(false);
    clearMarks();
    releaseRoots();
    map = null;
    mapped = [];
    reported = "";
    placing = null;
    placingPoint = null;
    placingGap = null;
    host.hidden = true;
  };

  return {
    get on() {
      return on;
    },
    update(next) {
      const before = state;
      state = next;
      if (!next.on) {
        if (on) turnOff();
        return;
      }
      if (!on) {
        on = true;
        listen(true);
        if (doc.body) observer?.observe(doc.body, { childList: true, subtree: true, characterData: true });
        listsAt = Date.now();
      }
      if (before?.revision !== next.revision) listsAt = Date.now();
      if (next.settling || before?.revision !== next.revision) pendingUntil = 0;
      selected = next.selected;
      remap();
      const current = byKey(selected);
      if (current && next.reveal) {
        const box = current.element.getBoundingClientRect();
        if (box.bottom < 0 || box.top > win.innerHeight) current.element.scrollIntoView({ block: "start", behavior: "instant" });
      }
      // Back to the keyboard: once the page shows the edit, the selected section has focus again.
      if (current && keepFocus && !next.settling && Date.now() >= pendingUntil && (!doc.activeElement || doc.activeElement === doc.body || doc.activeElement === current.element)) {
        keepFocus = false;
        focusShown = true;
        (current.element as HTMLElement).focus({ preventScroll: true });
        schedule();
      }
      if (current && !next.settling && (lastSpoken?.key !== current.key || lastSpoken.index !== current.index)) speak(current);
    },
    placing(field, label) {
      win.cancelAnimationFrame(scrollFrame);
      placingPoint = null;
      placingGap = null;
      placing = label && on ? { field: field ?? mapped[0]?.field ?? state?.lists[0]?.field ?? "", label } : null;
      if (placing) say(`Choose where ${label} goes: an insertion line between sections.`);
      schedule();
    },
    pointer(point) {
      if (!placing) return;
      const wasNull = placingPoint === null;
      placingPoint = point;
      updatePlacingGap();
      if (point && wasNull) {
        tickAt = 0;
        scrollFrame = win.requestAnimationFrame(placingTick);
      }
      if (!point) win.cancelAnimationFrame(scrollFrame);
    },
    drop() {
      if (placing && placingGap !== null) send({ type: "place", field: placing.field, index: placingGap });
    },
    appearance(look) {
      style.textContent = arrangeCss(look);
    },
    dispose() {
      turnOff();
      if (timers.remap) clearTimeout(timers.remap);
      if (timers.grace) clearTimeout(timers.grace);
      win.cancelAnimationFrame(frame);
      host.remove();
    },
  };
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}
