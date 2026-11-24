/**
 * The overlay: a guest in the site's own page, talking to the app that
 * framed it.
 *
 * Trust: it only listens to its direct parent window, and only at one
 * origin — the parent's, as the browser reports it (location.ancestorOrigins)
 * or, where the browser doesn't, the origin of the first protocol message the
 * parent sends. Until the parent speaks the protocol, editing stays off and
 * nothing is sent anywhere else.
 */
import type { HostToOverlay, OverlayRect, OverlayToHost, PageDrawState } from "@galley/core/types";
import { createArrange, type Arrange } from "./arrange";
import { beginEdit, type EditOutcome, type EditSession } from "./edit";
import { measurePage } from "./measure";
import { watchPage, type PageArrival } from "./page";
import { currentPath, watchNavigation, watchScroll } from "./navigation";
import { allowedFor, parseHostMessage, type OverlayRole } from "./protocol";
import { ACTIVE_CLASS, HOVER_CLASS, TAG_ACTION_ATTR, TAG_ATTR, applyAppearance, injectStyles } from "./styles";
import { collapse, editableTarget, findCopy, imageTarget, occurrenceOf, visibleText } from "./text";

/** What the overlay needs from its surroundings (the real window, or a test's). */
export interface OverlayEnv {
  win: Window;
  /** The parent window object, compared against `event.source`. */
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  /** The parent's origin when the browser reports it. */
  ancestorOrigin: string | null;
  role: OverlayRole;
  /** What the proxy said about this page (its status), when it said anything. */
  arrival?: PageArrival;
}

export interface Overlay {
  /** Say `ready` again (after the script was re-run by hot reload). */
  announce(): void;
  dispose(): void;
}

type Outgoing = OverlayToHost extends infer M ? (M extends { galley: 1 } ? Omit<M, "galley"> : never) : never;

const SCROLL_KEY = "galley:scroll:";
const TAG_TEXT = { text: "Click to edit", image: "Click to change", follow: "Follow link", control: "Works as on the site", editControl: "Edit text" } as const;
/** How long the tag waits before following the pointer off a link, so its "Follow link" button can be reached. */
const LINK_GRACE_MS = 260;

/** The link an element is, or sits in. */
function linkOf(element: Element | null): HTMLAnchorElement | null {
  const link = element?.closest("a[href]");
  return link && link.getAttribute("href") !== "" ? (link as HTMLAnchorElement) : null;
}

/**
 * A button that belongs to a form (a submit button, a "Send" link styled as
 * one). In Click to edit mode these keep working as they do on the site — a
 * click submits — because a form in the preview is there to be tried; their
 * words are edited deliberately, with the tag's "Edit text" (or Ctrl/⌘+Enter
 * from the keyboard). docs/visual-builder.md states the rule.
 */
function formControlOf(element: Element | null): HTMLElement | null {
  const control = element?.closest("button, input[type=submit], input[type=button], input[type=reset], [role=button]");
  return control && control.closest("form") ? (control as HTMLElement) : null;
}

/** "⌘Enter" on Apple systems, "Ctrl+Enter" elsewhere. */
function followKeys(win: Window): string {
  const platform = (win.navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? win.navigator.platform ?? "";
  return /mac|iphone|ipad/i.test(platform) ? "⌘Enter" : "Ctrl+Enter";
}

function rectOf(element: Element): OverlayRect {
  const box = element.getBoundingClientRect();
  return { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
}

function imageSrc(win: Window, image: HTMLImageElement): string {
  const raw = image.currentSrc || image.getAttribute("src") || "";
  try {
    const url = new URL(raw, win.location.href);
    return url.origin === win.location.origin ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return raw;
  }
}

export function createOverlay(env: OverlayEnv): Overlay {
  const { win, parent, role } = env;
  const doc = win.document;
  let hostOrigin = env.ancestorOrigin;
  let editMode = false;
  let hovered: Element | null = null;
  let selected: Element | null = null;
  let session: EditSession | null = null;
  /** The last confirmed in-place edit, so a refused save can be put back exactly. */
  let lastEdit: { element: Element; outcome: EditOutcome; occurrence: number } | null = null;
  let lastClick: { x: number; y: number } | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  const queue: Outgoing[] = [];
  /** Arrange mode's chrome, made the first time the host turns it on. */
  let arrange: Arrange | null = null;

  const send = (message: Outgoing) => {
    if (!hostOrigin) {
      // Not sure yet who is listening: hold the latest of each kind until the parent speaks.
      const at = queue.findIndex((queued) => queued.type === message.type);
      if (at >= 0) queue.splice(at, 1);
      queue.push(message);
      return;
    }
    parent.postMessage({ galley: 1, ...message }, hostOrigin);
  };

  injectStyles(doc);
  const tag = doc.createElement("div");
  tag.setAttribute(TAG_ATTR, "");
  tag.setAttribute("aria-hidden", "true");
  doc.documentElement.appendChild(tag);

  const hideTag = () => tag.removeAttribute("data-show");
  /**
   * The tag over the element. On a link it offers a second action, "Follow
   * link" (a button for the pointer; Ctrl/⌘+Enter for the keyboard, which the
   * tag spells out when the link has keyboard focus).
   */
  const showTag = (element: Element, how: "pointer" | "keyboard" = "pointer") => {
    const box = element.getBoundingClientRect();
    const link = imageTarget(element) ? null : linkOf(element);
    const control = imageTarget(element) ? null : formControlOf(element);
    tag.replaceChildren();
    const label = doc.createElement("span");
    if (imageTarget(element)) label.textContent = TAG_TEXT.image;
    else if (control && how === "keyboard") label.textContent = `Enter works as on the site · ${followKeys(win)} to edit text`;
    else if (control) label.textContent = TAG_TEXT.control;
    else if (link && how === "keyboard") label.textContent = `Enter to edit · ${followKeys(win)} to follow link`;
    else label.textContent = TAG_TEXT.text;
    tag.append(label);
    if (control && how === "pointer") {
      const edit = doc.createElement("button");
      edit.type = "button";
      edit.tabIndex = -1;
      edit.setAttribute(TAG_ACTION_ATTR, "edit");
      edit.textContent = TAG_TEXT.editControl;
      tag.append(edit);
    } else if (link && how === "pointer") {
      const follow = doc.createElement("button");
      follow.type = "button";
      follow.tabIndex = -1;
      follow.setAttribute(TAG_ACTION_ATTR, "follow");
      follow.textContent = `${TAG_TEXT.follow} ↗`;
      tag.append(follow);
    }
    // Sits right on the element's edge so the pointer can reach the tag's button without leaving.
    const top = box.top - 24 >= 4 ? box.top - 24 : box.bottom + 2;
    tag.style.setProperty("top", `${Math.round(top)}px`);
    tag.style.setProperty("left", `${Math.round(Math.max(4, Math.min(box.left - 2, win.innerWidth - (link || control ? 220 : 120))))}px`);
    tag.setAttribute("data-show", "");
  };
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  const setHovered = (element: Element | null, how: "pointer" | "keyboard" = "pointer") => {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = null;
    if (hovered === element) return;
    hovered?.classList.remove(HOVER_CLASS);
    hovered = element;
    if (!element) {
      hideTag();
      return;
    }
    element.classList.add(HOVER_CLASS);
    showTag(element, how);
  };

  /** Follow a link from edit mode: same-site links in this frame, others in a new tab. */
  const follow = (link: HTMLAnchorElement) => {
    let url: URL;
    try {
      url = new URL(link.href, win.location.href);
    } catch {
      return;
    }
    setHovered(null);
    if (url.origin === win.location.origin && (link.target === "" || link.target === "_self")) win.location.assign(url.href);
    else win.open(url.href, "_blank", "noopener");
  };
  const setSelected = (element: Element | null) => {
    selected?.classList.remove(ACTIVE_CLASS);
    selected = element;
    element?.classList.add(ACTIVE_CLASS);
  };

  const targetAt = (start: EventTarget | null): Element | null => {
    if (!start || (start as Node).nodeType !== 1) return null;
    const element = start as Element;
    if (element === tag) return null;
    return imageTarget(element) ?? editableTarget(element);
  };

  // ── edit-mode pointer handling (capture phase, so the site's own handlers never see a swallowed click)
  const onPointerOver = (event: Event) => {
    if (session) return;
    if (tag.contains(event.target as Node)) {
      // On the tag itself (its "Follow link" button): keep the link it belongs to.
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = null;
      return;
    }
    const next = targetAt(event.target);
    if (hovered && next !== hovered && (linkOf(hovered) || formControlOf(hovered))) {
      // Leaving a link or a form's button: wait a beat, in case the pointer is on its way to the tag's button.
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => setHovered(next), LINK_GRACE_MS);
      return;
    }
    setHovered(next);
  };
  const onPointerLeave = () => setHovered(null);
  /** Select an element for editing: tell the host what was clicked, so it can resolve the text. */
  const choose = (target: Element, at: { x: number; y: number } | null) => {
    lastClick = at;
    setHovered(null);
    setSelected(target);
    const image = imageTarget(target);
    if (image) {
      send({ type: "select-image", src: imageSrc(win, image), alt: image.getAttribute("alt") ?? "", rect: rectOf(image) });
      return;
    }
    const { text, occurrence, total } = occurrenceOf(target, doc);
    send({ type: "select", text, tag: target.tagName.toLowerCase(), occurrence, total, rect: rectOf(target) });
  };
  const onClick = (event: MouseEvent) => {
    if (tag.contains(event.target as Node)) {
      event.preventDefault();
      event.stopPropagation();
      const action = (event.target as Element).closest?.(`[${TAG_ACTION_ATTR}]`)?.getAttribute(TAG_ACTION_ATTR);
      const link = hovered ? linkOf(hovered) : null;
      if (link && action === "follow") follow(link);
      // "Edit text" on a form's button: the deliberate way to edit what it says.
      else if (hovered && action === "edit") choose(hovered, { x: event.clientX, y: event.clientY });
      return;
    }
    if (session && session.element.contains(event.target as Node)) return;
    if (event.metaKey || event.ctrlKey || event.button !== 0) return;
    const target = targetAt(event.target);
    if (!target) return;
    // A form's buttons work as on the site: the click goes through and the form submits.
    if (!imageTarget(target) && formControlOf(event.target as Element)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    choose(target, { x: event.clientX, y: event.clientY });
  };
  // The tag follows its element while the page scrolls under the pointer.
  const onScrollTag = () => {
    if (hovered) showTag(hovered, keyboardFocus === hovered ? "keyboard" : "pointer");
  };
  // Keyboard: a focused link shows how to edit it (Enter) and how to follow it (Ctrl/⌘+Enter).
  let keyboardFocus: Element | null = null;
  /** When the pointer last pressed: focus that follows a click is the pointer's, and keeps the pointer's tag (with its button). */
  let pointerDownAt = 0;
  const onPointerDown = () => {
    pointerDownAt = Date.now();
  };
  const onFocusIn = (event: FocusEvent) => {
    if (session || Date.now() - pointerDownAt < 600) return;
    const target = event.target as Element | null;
    const link = target ? (linkOf(target) ?? formControlOf(target)) : null;
    if (!link) return;
    const editable = targetAt(link);
    if (!editable) return;
    keyboardFocus = editable;
    setHovered(editable, "keyboard");
  };
  const onFocusOut = () => {
    if (!keyboardFocus) return;
    keyboardFocus = null;
    setHovered(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (session || event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    // On a form's button, Ctrl/⌘+Enter edits its words (plain Enter presses it, as on the site).
    const control = formControlOf(event.target as Element | null);
    const editable = control ? targetAt(control) : null;
    if (editable) {
      event.preventDefault();
      event.stopPropagation();
      choose(editable, null);
      return;
    }
    const link = linkOf(event.target as Element | null);
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    follow(link);
  };

  const setEditMode = (on: boolean) => {
    const next = on && role === "edit";
    if (next === editMode) return;
    editMode = next;
    if (editMode) {
      doc.addEventListener("pointerover", onPointerOver, true);
      doc.documentElement.addEventListener("pointerleave", onPointerLeave);
      win.addEventListener("click", onClick, true);
      win.addEventListener("scroll", onScrollTag, { passive: true });
      doc.addEventListener("pointerdown", onPointerDown, true);
      doc.addEventListener("focusin", onFocusIn, true);
      doc.addEventListener("focusout", onFocusOut, true);
      win.addEventListener("keydown", onKeyDown, true);
    } else {
      doc.removeEventListener("pointerover", onPointerOver, true);
      doc.documentElement.removeEventListener("pointerleave", onPointerLeave);
      win.removeEventListener("click", onClick, true);
      win.removeEventListener("scroll", onScrollTag);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("focusin", onFocusIn, true);
      doc.removeEventListener("focusout", onFocusOut, true);
      win.removeEventListener("keydown", onKeyDown, true);
      keyboardFocus = null;
      session?.finish(false);
      setHovered(null);
      setSelected(null);
    }
  };

  const startEdit = (text: string, occurrence: number) => {
    session?.finish(false);
    const wanted = collapse(text);
    const element = selected && occurrenceOf(selected, doc).text === wanted ? selected : findCopy(doc, wanted, occurrence);
    if (!element || !("contentEditable" in element)) return;
    const { total } = occurrenceOf(element, doc);
    setSelected(null);
    session = beginEdit(element as HTMLElement, lastClick, (outcome) => {
      session = null;
      if (outcome.newText === outcome.text) {
        lastEdit = null;
        send({ type: "edit-cancelled", text: outcome.text, occurrence });
        return;
      }
      lastEdit = { element, outcome, occurrence };
      send({ type: "edit", text: outcome.text, newText: outcome.newText, occurrence, total });
    });
  };

  /** The host refused the last save: show the stored text again, markup and all. */
  const restoreText = (text: string, newText: string, occurrence: number) => {
    const wanted = collapse(newText);
    if (lastEdit && lastEdit.element.isConnected && collapse(lastEdit.outcome.newText) === wanted && collapse(visibleText(lastEdit.element)) === wanted) {
      lastEdit.outcome.restore();
      lastEdit = null;
      return;
    }
    const element = findCopy(doc, wanted, occurrence);
    if (element) element.textContent = text;
    lastEdit = null;
  };

  const highlight = (text: string, occurrence: number | undefined) => {
    if (highlightTimer) clearTimeout(highlightTimer);
    setSelected(null);
    if (!text) return;
    const element = findCopy(doc, text, occurrence ?? 0);
    if (!element) return;
    setSelected(element);
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    highlightTimer = setTimeout(() => setSelected(null), 3500);
  };

  let look: { accent: string; theme: "light" | "dark" } | null = null;
  const scroll = watchScroll(win, (y) => send({ type: "scroll", y }));
  const rememberScroll = () => {
    try {
      win.sessionStorage.setItem(SCROLL_KEY + currentPath(win), String(Math.round(win.scrollY)));
    } catch {
      // Storage may be off for this site; the browser's own restoration still applies.
    }
  };

  const obey = (message: HostToOverlay) => {
    switch (message.type) {
      case "mode":
        setEditMode(message.edit && !arrange?.on);
        return;
      case "begin-edit":
        if (editMode) startEdit(message.text, message.occurrence);
        return;
      case "cancel-edit":
        session?.finish(false);
        setSelected(null);
        return;
      case "scroll":
        scroll.suppress();
        win.scrollTo({ top: message.y, left: win.scrollX, behavior: "instant" });
        return;
      case "highlight":
        highlight(message.text, message.occurrence);
        return;
      case "reload":
        rememberScroll();
        win.location.reload();
        return;
      case "restore-text":
        restoreText(message.text, message.newText, message.occurrence);
        return;
      case "appearance":
        applyAppearance(doc, { accent: message.accent, theme: message.theme });
        tag.setAttribute("data-theme", message.theme);
        look = { accent: message.accent, theme: message.theme };
        arrange?.appearance(look);
        return;
      case "arrange":
        if (message.on) setEditMode(false);
        if (!arrange && !message.on) return;
        if (!arrange) {
          arrange = createArrange(win, send, () => page?.current() ?? null);
          if (look) arrange.appearance(look);
        }
        arrange.update(message);
        return;
      case "placing":
        arrange?.placing(message.field, message.label);
        return;
      case "placing-pointer":
        arrange?.pointer(message.point);
        return;
      case "placing-drop":
        arrange?.drop();
        return;
      case "measure": {
        // Read-only: sampling computed styles changes nothing on the page.
        let summary: ReturnType<typeof measurePage>;
        try {
          summary = measurePage(win);
        } catch {
          return;
        }
        send({ type: "measure-result", id: message.id, summary });
        return;
      }
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== parent) return;
    const message = parseHostMessage(event.data);
    if (!message) return;
    if (hostOrigin === null) {
      hostOrigin = event.origin;
      for (const queued of queue.splice(0)) send(queued);
    }
    if (event.origin !== hostOrigin) return;
    if (allowedFor(role, message)) obey(message);
  };
  win.addEventListener("message", onMessage);

  const stopNavigation = watchNavigation(win, (path) => {
    session?.finish(true);
    setHovered(null);
    setSelected(null);
    send({ type: "navigate", path, title: doc.title });
  });
  win.addEventListener("pagehide", rememberScroll);

  // After a reload (hot reload included), go back to where the person was.
  try {
    const key = SCROLL_KEY + currentPath(win);
    const saved = win.sessionStorage.getItem(key);
    if (saved !== null) {
      win.sessionStorage.removeItem(key);
      const y = Number(saved);
      const restore = () => {
        scroll.suppress();
        win.scrollTo({ top: y, left: 0, behavior: "instant" });
      };
      restore();
      win.addEventListener("load", restore, { once: true });
    }
  } catch {
    // No storage: nothing to restore.
  }

  // Whether this page was drawn, said after every `ready` from the proposed page and again when it changes.
  const onPage = (state: PageDrawState) => {
    send({ type: "page-state", ...state });
    arrange?.refresh();
  };
  const page = role === "edit" ? watchPage(win, env.arrival ?? { status: null, unavailable: false }, onPage) : null;
  const announce = () => {
    send({ type: "ready", path: currentPath(win), title: doc.title });
    if (page) send({ type: "page-state", ...page.current() });
  };
  announce();

  return {
    announce,
    dispose() {
      setEditMode(false);
      scroll.dispose();
      stopNavigation();
      win.removeEventListener("message", onMessage);
      win.removeEventListener("pagehide", rememberScroll);
      if (highlightTimer) clearTimeout(highlightTimer);
      if (leaveTimer) clearTimeout(leaveTimer);
      arrange?.dispose();
      page?.dispose();
      tag.remove();
    },
  };
}
