/**
 * The host → overlay half of the protocol, checked field by field. Anything
 * that is not exactly one of the HostToOverlay shapes is dropped, whoever
 * sent it.
 */
import type { HostToOverlay, OverlaySection, OverlaySectionList } from "@galley/core/types";
import { isHexColor } from "./styles";

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isText = (value: unknown, max = 200): value is string => typeof value === "string" && value.length <= max;
const texts = (value: unknown, max: number): string[] | null =>
  Array.isArray(value) && value.length <= 64 && value.every((item) => isText(item, max)) ? (value as string[]) : null;

function section(value: unknown): OverlaySection | null {
  if (!isObject(value) || !isCount(value.index) || !isText(value.type) || !isText(value.label)) return null;
  const strings = texts(value.texts, 4000);
  const images = texts(value.images, 2000);
  return strings && images ? { index: value.index, type: value.type, label: value.label, texts: strings, images } : null;
}

/** The entry's section lists, or null when any part isn't one. */
function sectionLists(value: unknown): OverlaySectionList[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const out: OverlaySectionList[] = [];
  for (const list of value) {
    if (!isObject(list) || !isText(list.field) || !Array.isArray(list.sections) || list.sections.length > 500) return null;
    const sections = list.sections.map(section);
    if (sections.some((item) => item === null)) return null;
    out.push({ field: list.field, sections: sections as OverlaySection[] });
  }
  return out;
}

/** The message as a HostToOverlay, or null when it isn't one. */
export function parseHostMessage(data: unknown): HostToOverlay | null {
  if (!isObject(data) || data.galley !== 1) return null;
  switch (data.type) {
    case "mode":
      return typeof data.edit === "boolean" ? { galley: 1, type: "mode", edit: data.edit } : null;
    case "begin-edit":
      return typeof data.text === "string" && isCount(data.occurrence) ? { galley: 1, type: "begin-edit", text: data.text, occurrence: data.occurrence } : null;
    case "cancel-edit":
      return { galley: 1, type: "cancel-edit" };
    case "scroll":
      return typeof data.y === "number" && Number.isFinite(data.y) ? { galley: 1, type: "scroll", y: Math.max(0, data.y) } : null;
    case "highlight":
      if (typeof data.text !== "string") return null;
      if (data.occurrence !== undefined && !isCount(data.occurrence)) return null;
      return data.occurrence === undefined ? { galley: 1, type: "highlight", text: data.text } : { galley: 1, type: "highlight", text: data.text, occurrence: data.occurrence };
    case "reload":
      return { galley: 1, type: "reload" };
    case "restore-text":
      return typeof data.text === "string" && typeof data.newText === "string" && isCount(data.occurrence)
        ? { galley: 1, type: "restore-text", text: data.text, newText: data.newText, occurrence: data.occurrence }
        : null;
    case "appearance":
      return isHexColor(data.accent) && (data.theme === "light" || data.theme === "dark") ? { galley: 1, type: "appearance", accent: data.accent, theme: data.theme } : null;
    case "arrange": {
      const lists = sectionLists(data.lists);
      if (!lists || typeof data.on !== "boolean" || typeof data.editable !== "boolean" || typeof data.settling !== "boolean" || typeof data.reveal !== "boolean" || !isCount(data.revision)) return null;
      if (data.selected !== null && !isText(data.selected)) return null;
      return { galley: 1, type: "arrange", on: data.on, lists, editable: data.editable, selected: data.selected, settling: data.settling, revision: data.revision, reveal: data.reveal };
    }
    case "placing":
      if ((data.label !== null && !isText(data.label)) || (data.field !== null && !isText(data.field))) return null;
      return { galley: 1, type: "placing", field: data.field, label: data.label };
    case "placing-pointer": {
      if (data.point === null) return { galley: 1, type: "placing-pointer", point: null };
      const point = data.point;
      return isObject(point) && typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? { galley: 1, type: "placing-pointer", point: { x: point.x, y: point.y } }
        : null;
    }
    case "placing-drop":
      return { galley: 1, type: "placing-drop" };
    case "marks": {
      const lists = sectionLists(data.lists);
      if (!lists || !Array.isArray(data.marks) || data.marks.length > 32) return null;
      const marks: Array<{ field: string; index: number; color: string }> = [];
      for (const item of data.marks) {
        if (!isObject(item) || !isText(item.field) || !isCount(item.index) || !isHexColor(item.color)) return null;
        marks.push({ field: item.field, index: item.index, color: item.color });
      }
      return { galley: 1, type: "marks", lists, marks };
    }
    case "measure":
      return typeof data.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(data.id) ? { galley: 1, type: "measure", id: data.id } : null;
    default:
      return null;
  }
}

/** What the page lets the host do: the proposed page is editable, the deployed one only follows. */
export type OverlayRole = "edit" | "follow";

/** Host messages a role obeys. The follow role only scrolls, reloads and takes the app's look. */
export function allowedFor(role: OverlayRole, message: HostToOverlay): boolean {
  if (role === "edit") return true;
  return message.type === "scroll" || message.type === "reload" || message.type === "mode" || message.type === "appearance";
}
