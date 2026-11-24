/**
 * The three addresses of a hosted install, and the name everything created
 * for it carries. Pure functions with type-only imports, so the web app and
 * the command line can check a form without the engine.
 *
 * The preview and live comparison names are derived exactly as the install
 * derives its own defaults (packages/server/src/gateway.ts,
 * `defaultGatewayOrigins`; a test keeps the two in step): `localhost`,
 * `*.localhost` and a two-label name (an apex) get `preview.` / `live.`
 * prefixed — a sibling of an apex would be someone else's domain — and any
 * other name gets `-preview` / `-live` on its first label, so all three sit
 * one level below the same domain (what a free certificate covers).
 */
import type { EditorAddresses } from "./types";

/** One DNS label: letters, digits and dashes, at most 63, not starting or ending with a dash. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** "Cms.Example.com." → "cms.example.com". */
export function normalizeAddress(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, "");
}

/** Why a typed address can't be an install's hostname, in plain words; null when it can. */
export function addressProblem(input: string, what = "The editor's address"): string | null {
  const address = normalizeAddress(input);

  if (!address) return `${what} is missing. Type a name like cms.example.com.`;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(address)) return `${what} should be just the name, without “${address.split("//")[0]}//” — like cms.example.com.`;
  if (address.includes("*")) return `${what} can't be a wildcard. Type one name, like cms.example.com.`;
  if (/[/?#@]/.test(address)) return `${what} should be just the name, without a path — like cms.example.com.`;
  if (address.startsWith("[") || address.includes(":")) {
    return address.split(":").length > 2 ? `${what} should be a name, not an IP address: HTTPS needs a name, like cms.example.com.` : `${what} should be just the name, without a port — like cms.example.com.`;
  }
  if (IPV4.test(address)) return `${what} should be a name, not an IP address: HTTPS needs a name, like cms.example.com.`;
  if (address.length > 253) return `${what} is too long for a domain name.`;
  const labels = address.split(".");

  if (labels.some((label) => !LABEL.test(label))) return `${what} can only use letters, digits, dashes and dots, like cms.example.com.`;
  if (labels.length < 2 && address !== "localhost") return `${what} needs a domain, like cms.example.com.`;
  return null;
}

/**
 * The preview and live comparison names that go with an editor address, or
 * null when none can be derived (an IP address, a one-label name, a first
 * label too long to take “-preview”).
 */
export function deriveAddresses(editorInput: string): EditorAddresses | null {
  const editor = normalizeAddress(editorInput);

  if (!editor || editor.startsWith("[") || editor.includes(":") || IPV4.test(editor)) return null;
  const labels = editor.split(".");

  if (editor === "localhost" || editor.endsWith(".localhost") || labels.length === 2) return { editor, preview: `preview.${editor}`, live: `live.${editor}` };
  if (labels.length < 2) return null;
  const [first, ...rest] = labels as [string, ...string[]];

  // A DNS label is at most 63 characters.
  if (first.length + "-preview".length > 63) return null;
  return { editor, preview: `${first}-preview.${rest.join(".")}`, live: `${first}-live.${rest.join(".")}` };
}

/**
 * The three addresses a request asks for — the derived defaults unless it
 * names the preview and live comparison itself — or the first problem with
 * them, in plain words.
 */
export function resolveAddresses(input: { address: string; previewAddress?: string; liveAddress?: string }): { addresses: EditorAddresses } | { problem: string } {
  const problem = addressProblem(input.address);

  if (problem) return { problem };
  const editor = normalizeAddress(input.address);
  const derived = deriveAddresses(editor);
  const preview = input.previewAddress?.trim() ? normalizeAddress(input.previewAddress) : derived?.preview;
  const live = input.liveAddress?.trim() ? normalizeAddress(input.liveAddress) : derived?.live;

  if (!preview || !live) {
    return { problem: `The preview and the live comparison need addresses of their own, and none can be made from ${editor}. Type them too, like cms-preview.example.com and cms-live.example.com.` };
  }
  const previewProblem = addressProblem(preview, "The preview's address") ?? addressProblem(live, "The live comparison's address");

  if (previewProblem) return { problem: previewProblem };
  if (new Set([editor, preview, live]).size < 3) return { problem: "The editor, the preview and the live comparison each need an address of their own." };
  return { addresses: { editor, preview, live } };
}

/**
 * Names everything created carries: 2–25 lowercase letters, digits and
 * dashes, starting with a letter. 25 keeps the disk's name on Fly.io
 * (`<name>_data`, at most 30) and every derived name within each host's limits.
 */
export const EDITOR_NAME = /^[a-z](?:[a-z0-9-]{0,23}[a-z0-9])$/;
export const MAX_EDITOR_NAME = 25;

export function editorNameProblem(name: string): string | null {
  if (!name) return "Give the editor a short name, like “acme-editor”.";
  if (name.length > MAX_EDITOR_NAME) return `Keep the name to ${MAX_EDITOR_NAME} characters or fewer.`;
  if (!EDITOR_NAME.test(name) || name.includes("--")) return "Use lowercase letters, digits and single dashes, starting with a letter and ending with a letter or digit — like “acme-editor”.";
  return null;
}

/** "Lowfield Studio" → "lowfield-studio-editor": a name every host accepts, from the site's own name. */
export function defaultEditorName(siteName: string): string {
  const suffix = "-editor";
  let slug = siteName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) slug = "site";
  if (!/^[a-z]/.test(slug)) slug = `site-${slug}`;
  const room = MAX_EDITOR_NAME - suffix.length;

  if (slug.length > room) {
    // Cut between words, not inside one, when there is a word boundary to cut at.
    const cut = slug.slice(0, room);

    slug = slug[room] === "-" || !cut.includes("-") ? cut : cut.slice(0, cut.lastIndexOf("-"));
  }
  return `${slug.replace(/-+$/g, "")}${suffix}`;
}

/** How many labels `host` has below `zone` ("cms.example.com" in "example.com" → 1); -1 when it isn't in the zone. */
export function depthBelow(host: string, zone: string): number {
  if (host === zone) return 0;
  if (!host.endsWith(`.${zone}`)) return -1;
  return host.slice(0, -(zone.length + 1)).split(".").length;
}
