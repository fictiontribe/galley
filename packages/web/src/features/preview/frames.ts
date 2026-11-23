/**
 * The host side of the overlay protocol, as plain functions: which messages
 * are real, where a frame should point, and the preview's own back/forward
 * history (the frames are cross-origin, so their history can't be read).
 */
import type { HostToOverlay, OverlayRect, OverlayToHost } from "@galley/core/types";

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isPath = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && !value.startsWith("//");

function isRect(value: unknown): value is OverlayRect {
  return isObject(value) && ["x", "y", "width", "height"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

/** The message as an OverlayToHost, checked field by field, or null. */
export function parseOverlayMessage(data: unknown): OverlayToHost | null {
  if (!isObject(data) || data.galley !== 1) return null;
  switch (data.type) {
    case "ready":
    case "navigate":
      return isPath(data.path) && typeof data.title === "string" ? { galley: 1, type: data.type, path: data.path, title: data.title } : null;
    case "select":
      return typeof data.text === "string" && typeof data.tag === "string" && isCount(data.occurrence) && isCount(data.total) && isRect(data.rect)
        ? { galley: 1, type: "select", text: data.text, tag: data.tag, occurrence: data.occurrence, total: data.total, rect: data.rect }
        : null;
    case "select-image":
      return typeof data.src === "string" && typeof data.alt === "string" && isRect(data.rect) ? { galley: 1, type: "select-image", src: data.src, alt: data.alt, rect: data.rect } : null;
    case "edit":
      return typeof data.text === "string" && typeof data.newText === "string" && isCount(data.occurrence) && isCount(data.total)
        ? { galley: 1, type: "edit", text: data.text, newText: data.newText, occurrence: data.occurrence, total: data.total }
        : null;
    case "edit-cancelled":
      return typeof data.text === "string" && isCount(data.occurrence) ? { galley: 1, type: "edit-cancelled", text: data.text, occurrence: data.occurrence } : null;
    case "scroll":
      return typeof data.y === "number" && Number.isFinite(data.y) ? { galley: 1, type: "scroll", y: data.y } : null;
    case "arrange-status":
      if (data.status !== "mapped" && data.status !== "waiting" && data.status !== "declined") return null;
      if (data.how !== null && data.how !== "markers" && data.how !== "evidence") return null;
      if ((data.reason !== null && typeof data.reason !== "string") || !isCount(data.revision)) return null;
      return { galley: 1, type: "arrange-status", status: data.status, how: data.how, reason: data.reason, revision: data.revision };
    case "arrange-select":
      return data.key === null || isKey(data.key) ? { galley: 1, type: "arrange-select", key: data.key } : null;
    case "arrange-action": {
      if (typeof data.field !== "string" || !isCount(data.index)) return null;
      const { field, index } = data;
      switch (data.action) {
        case "move":
          return isCount(data.to) ? { galley: 1, type: "arrange-action", action: "move", field, index, to: data.to } : null;
        case "step":
          return data.delta === 1 || data.delta === -1 ? { galley: 1, type: "arrange-action", action: "step", field, index, delta: data.delta } : null;
        case "duplicate":
        case "remove":
        case "edit":
        case "options":
        case "add":
        case "undo":
          return { galley: 1, type: "arrange-action", action: data.action, field, index };
        default:
          return null;
      }
    }
    case "placing-at":
      if (data.field === null && data.index === null) return { galley: 1, type: "placing-at", field: null, index: null };
      return typeof data.field === "string" && isCount(data.index) ? { galley: 1, type: "placing-at", field: data.field, index: data.index } : null;
    case "place":
      return typeof data.field === "string" && isCount(data.index) ? { galley: 1, type: "place", field: data.field, index: data.index } : null;
    default:
      return null;
  }
}

/** "sections.3": a blocks field key and a position. */
const isKey = (value: unknown): value is string => typeof value === "string" && /^[^\s]+\.\d+$/.test(value) && value.length <= 200;

/** Builds a host → overlay message. */
export function toOverlay(message: HostToOverlay extends infer M ? (M extends { galley: 1 } ? Omit<M, "galley"> : never) : never): HostToOverlay {
  return { galley: 1, ...message } as HostToOverlay;
}

/** The frame address for a page path on a proxy origin. */
export function frameUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * What the address field accepts: a path on this site ("pricing", "/pricing/")
 * or a full address on the preview's own origin. Anything else is null.
 */
export function addressToPath(input: string, origins: Array<string | null>): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    try {
      const url = new URL(text);
      if (!origins.some((origin) => origin && new URL(origin).origin === url.origin)) return null;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }
  if (text.startsWith("//")) return null;
  return text.startsWith("/") ? text : `/${text}`;
}

/** The page part of a path (no query or fragment), for looking up the entry behind it. */
export function pagePath(path: string): string {
  return path.split(/[?#]/)[0] || "/";
}

export interface NavHistory {
  entries: string[];
  index: number;
  /** An entry we asked the frame to go to (back/forward), until it reports arriving. */
  pendingIndex: number | null;
}

const MAX_ENTRIES = 50;

export function startHistory(path: string): NavHistory {
  return { entries: [path], index: 0, pendingIndex: null };
}

/** The frame reported being at `path`. */
export function visit(history: NavHistory, path: string): NavHistory {
  if (history.pendingIndex !== null && history.entries[history.pendingIndex] === path) {
    return { ...history, index: history.pendingIndex, pendingIndex: null };
  }
  if (history.entries[history.index] === path) return { ...history, pendingIndex: null };
  const entries = [...history.entries.slice(0, history.index + 1), path].slice(-MAX_ENTRIES);
  return { entries, index: entries.length - 1, pendingIndex: null };
}

/** Back (-1) or forward (+1): the new history and the path to send the frame to, or null at an end. */
export function go(history: NavHistory, delta: -1 | 1): { history: NavHistory; path: string } | null {
  const target = history.index + delta;
  const path = history.entries[target];
  if (path === undefined) return null;
  return { history: { ...history, pendingIndex: target }, path };
}

export const canGo = (history: NavHistory, delta: -1 | 1): boolean => history.entries[history.index + delta] !== undefined;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `rgb(46, 43, 255)` or `#2e2bff` → `#2E2BFF`; anything else → null. */
export function toHex(value: string): string | null {
  const text = value.trim();
  if (HEX_COLOR.test(text)) return text.toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(text);
  if (!rgb) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

