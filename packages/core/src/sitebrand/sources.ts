/**
 * The material people add to set a brand up: PDFs, pictures, SVG logos,
 * text notes, a website's address. Untrusted, every byte of it.
 *
 * - Type is sniffed from the bytes, never taken from the name.
 * - Size and count are capped; uploads arrive in chunks so a large guideline
 *   PDF fits under the API's request limit.
 * - Pictures are decoded and re-encoded as a plain PNG (png.ts) before
 *   anything reads them; other raster formats arrive as a PNG the browser
 *   made, and are re-encoded the same way.
 * - SVG is parsed as data and never rendered with scripts.
 *
 * Until "Save the brand" nothing is in the site: added material waits in the
 * app's own folder for the site (`<home>/state/<siteId>/brand/`). On save,
 * files under the size threshold are copied into `<dir>/sources/`; larger
 * ones stay where they are and the manifest says so.
 */
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageSize } from "image-size";
import { GalleyError } from "../errors";
import { decodePng, downscale, encodePng, isPng, paletteOf, type PaletteEntry } from "./png";
import { readPdf, type PdfSummary } from "./pdf";
import { readSvg, type SvgSummary } from "./svg";
import type { BrandSource, SourceType } from "./types";

export const SOURCE_LIMITS = {
  /** One file. */
  fileBytes: 100 * 1024 * 1024,
  /** Sources per site. */
  count: 40,
  /** Everything waiting to be saved, together. */
  stagedBytes: 300 * 1024 * 1024,
  /** One upload chunk (base64 decoded). Leaves room under the server's 40 MB request limit. */
  chunkBytes: 8 * 1024 * 1024,
  /** The browser-made preview of a picture. */
  previewBytes: 6 * 1024 * 1024,
  /** Longest edge of a picture as the model sees it. */
  modelEdge: 1568,
  /** Text read from a note. */
  textChars: 100_000,
} as const;

export interface SourceFacts {
  palette?: PaletteEntry[];
  svg?: SvgSummary;
  pdf?: PdfSummary;
  textChars?: number;
  /** For a website: what was fetched. */
  website?: { url: string; title: string; css: number; textChars: number };
}

/** A source as the app keeps it for the site: the public record plus where its bytes are. */
export interface StoredSource extends BrandSource {
  /** Absolute path of the bytes in the app's folder, while they are there. */
  bytesPath: string | null;
  /** Absolute path of the re-encoded PNG the model reads (pictures). */
  analysisPath: string | null;
  facts: SourceFacts;
  /** Not saved into the site yet. */
  staged: boolean;
  /**
   * Added and not read yet. Kept here, beside the bytes, so it survives a
   * restart and doesn't depend on a proposal being open: material added to a
   * saved brand is offered for reading too.
   */
  unread?: boolean;
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

/** What the bytes are. Refuses anything that isn't a PDF, a picture, SVG or plain text. */
export function sniff(bytes: Uint8Array): { type: SourceType; mime: string } {
  const head = Buffer.from(bytes.subarray(0, 16));
  const ascii = head.toString("latin1");

  if (ascii.startsWith("%PDF-")) return { type: "pdf", mime: "application/pdf" };
  if (isPng(bytes)) return { type: "image", mime: "image/png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { type: "image", mime: "image/jpeg" };
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return { type: "image", mime: "image/gif" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return { type: "image", mime: "image/webp" };
  let text: string;

  try {
    text = TEXT_DECODER.decode(bytes.subarray(0, Math.min(bytes.length, 4 * 1024 * 1024)));
  } catch {
    throw new GalleyError("invalid", "That kind of file can't be read here. Add PDFs, pictures (PNG, JPG, WebP, GIF or SVG), or text notes.");
  }
  if (text.includes("\u0000")) throw new GalleyError("invalid", "That kind of file can't be read here. Add PDFs, pictures (PNG, JPG, WebP, GIF or SVG), or text notes.");
  const start = text.replace(/^﻿/, "").replace(/^\s*(<\?xml[\s\S]*?\?>)?\s*(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?/i, "");

  if (/^<svg[\s>]/i.test(start)) return { type: "svg", mime: "image/svg+xml" };
  return { type: "text", mime: "text/plain" };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** A file name safe to keep: letters, digits, dots and dashes, its extension from the sniffed type. */
export function safeSourceName(name: string, type: SourceType, mime: string): string {
  const ext = { pdf: "pdf", svg: "svg", text: "md", website: "json" }[type as "pdf"] ?? ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[mime] ?? "bin");
  const stem = name
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60) || "source";

  return `${stem}.${ext}`;
}

/** Deterministic facts, and the plain sentences about them. */
export function factsOf(type: SourceType, bytes: Uint8Array): { facts: SourceFacts; learned: string[]; pages?: number; width?: number; height?: number } {
  if (type === "pdf") {
    const pdf = readPdf(bytes);
    const learned: string[] = [];

    if (pdf.encrypted) learned.push("It is protected, so only its size could be read.");
    if (pdf.pages) learned.push(`${pdf.pages === 1 ? "1 page" : `${pdf.pages} pages`}.`);
    if (pdf.fonts.length) learned.push(`Fonts inside it: ${pdf.fonts.map((font) => font.family).join(", ")}.`);
    const painted = pdf.colors.filter((color) => color.share >= 0.02).slice(0, 5);

    if (painted.length) learned.push(`Colours that fill most of its pages: ${painted.map((color) => `${color.color} (${Math.round(color.share * 100)}%)`).join(", ")}.`);
    return { facts: { pdf }, learned, pages: pdf.pages };
  }
  if (type === "svg") {
    const svg = readSvg(Buffer.from(bytes).toString("utf8"));
    const learned = [`Drawn on a ${svg.viewBox ? `${svg.viewBox} ` : ""}canvas${svg.colors.length ? ` in ${svg.colors.map((color) => color.color).join(", ")}` : ""}.`];

    if (svg.active) learned.push("It contained scripts or links, which were left out; it is only ever shown as a picture.");
    return { facts: { svg }, learned, ...(svg.width ? { width: Math.round(svg.width) } : {}), ...(svg.height ? { height: Math.round(svg.height) } : {}) };
  }
  if (type === "text") {
    const chars = Buffer.from(bytes).toString("utf8").length;

    return { facts: { textChars: chars }, learned: [chars > SOURCE_LIMITS.textChars ? `A long note; the first ${SOURCE_LIMITS.textChars.toLocaleString("en")} characters are read.` : "A note to read with the rest."] };
  }
  return { facts: {}, learned: [] };
}

/** The picture the model sees and the palette: decoded, shrunk and re-encoded from a PNG. */
export function preparePicture(png: Uint8Array): { analysis: Uint8Array; palette: PaletteEntry[]; width: number; height: number } {
  const decoded = decodePng(png);
  let small = downscale(decoded, SOURCE_LIMITS.modelEdge);
  let analysis = encodePng(small);

  // The API takes up to 5 MB per picture as base64; keep well under it.
  if (analysis.length > 3_500_000) {
    small = downscale(decoded, 1024);
    analysis = encodePng(small);
  }
  return { analysis, palette: paletteOf(decoded), width: decoded.width, height: decoded.height };
}

function dataUrlPng(value: string): Uint8Array {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(value);

  if (!match) throw new GalleyError("invalid", "The picture's preview couldn't be read. Add the file again.");
  const bytes = Buffer.from(match[1]!.replace(/\s+/g, ""), "base64");

  if (bytes.length > SOURCE_LIMITS.previewBytes) throw new GalleyError("invalid", "The picture's preview is too large. Add the file again.");
  if (!isPng(bytes)) throw new GalleyError("invalid", "The picture's preview isn't a PNG. Add the file again.");
  return new Uint8Array(bytes);
}

export interface UploadChunk {
  uploadId?: string;
  name: string;
  note?: string;
  /** Total size of the file in bytes. */
  total: number;
  offset: number;
  /** base64 of this chunk's bytes. */
  chunk: string;
  /** For pictures that aren't PNG: a PNG of it made by the browser (data: URL). */
  preview?: string;
}

interface Upload {
  id: string;
  path: string;
  received: number;
  total: number;
  name: string;
  note?: string;
  startedAt: number;
}

export function createSourceStore(home: string) {
  const uploads = new Map<string, Upload>();
  const dirOf = (siteId: string) => join(home, "state", siteId, "brand");
  const indexOf = (siteId: string) => join(dirOf(siteId), "sources.json");
  const locks = new Map<string, Promise<unknown>>();
  const locked = <T>(siteId: string, run: () => Promise<T>): Promise<T> => {
    const next = (locks.get(siteId) ?? Promise.resolve()).then(run, run);

    locks.set(siteId, next.catch(() => undefined));
    return next;
  };

  async function list(siteId: string): Promise<StoredSource[]> {
    try {
      const parsed = JSON.parse(await readFile(indexOf(siteId), "utf8")) as { sources?: StoredSource[] };

      return Array.isArray(parsed.sources) ? parsed.sources : [];
    } catch {
      return [];
    }
  }

  async function save(siteId: string, sources: StoredSource[]): Promise<void> {
    await mkdir(dirOf(siteId), { recursive: true });
    const temp = `${indexOf(siteId)}.${randomBytes(4).toString("hex")}.tmp`;

    await writeFile(temp, `${JSON.stringify({ sources }, null, 2)}\n`);
    await rename(temp, indexOf(siteId));
  }

  async function finish(siteId: string, upload: Upload, preview: string | undefined): Promise<StoredSource> {
    const bytes = new Uint8Array(await readFile(upload.path));
    const { type, mime } = sniff(bytes);
    const id = upload.id;
    const finalPath = join(dirOf(siteId), "files", id);
    let analysisPath: string | null = null;
    let width: number | undefined;
    let height: number | undefined;
    const info = factsOf(type, bytes);

    if (type === "image") {
      let png: Uint8Array | null = mime === "image/png" ? bytes : null;

      if (!png && preview) png = dataUrlPng(preview);
      if (png) {
        const picture = preparePicture(png);

        analysisPath = join(dirOf(siteId), "files", `${id}.analysis.png`);
        await mkdir(join(dirOf(siteId), "files"), { recursive: true });
        await writeFile(analysisPath, picture.analysis);
        info.facts.palette = picture.palette;
        info.learned.push(`Colours by area: ${picture.palette.slice(0, 6).map((entry) => `${entry.color} (${Math.round(entry.share * 100)}%)`).join(", ")}.`);
      } else {
        info.learned.push("This kind of picture can only be read once the app has made a copy of it in the browser; add it from the Brand screen.");
      }
      try {
        const size = imageSize(bytes);

        width = size.width;
        height = size.height;
      } catch {
        // Its size is shown when known.
      }
    }
    await mkdir(join(dirOf(siteId), "files"), { recursive: true });
    await rename(upload.path, finalPath);
    const note = upload.note?.trim().slice(0, 300);
    const source: StoredSource = {
      id,
      name: upload.name.slice(0, 200),
      type,
      mime,
      bytes: bytes.length,
      sha256: sha256(bytes),
      addedAt: new Date().toISOString(),
      ...(note ? { note } : {}),
      stored: "outside",
      ...(info.pages ? { pages: info.pages } : {}),
      ...((width ?? info.width) ? { width: width ?? info.width } : {}),
      ...((height ?? info.height) ? { height: height ?? info.height } : {}),
      learned: info.learned,
      bytesPath: finalPath,
      analysisPath,
      facts: info.facts,
      staged: true,
    };

    return source;
  }

  return {
    dir: dirOf,
    list,
    save: (siteId: string, sources: StoredSource[]) => locked(siteId, () => save(siteId, sources)),

    /** Takes one chunk; the last one finishes the upload and returns the source. */
    async receive(siteId: string, input: UploadChunk): Promise<{ uploadId: string; received: number; source: StoredSource | null }> {
      if (!Number.isInteger(input.total) || input.total <= 0) throw new GalleyError("invalid", "That file is empty.");
      if (input.total > SOURCE_LIMITS.fileBytes) throw new GalleyError("invalid", `That file is too large. Material can be up to ${megabytes(SOURCE_LIMITS.fileBytes)} a file.`);
      const chunk = Buffer.from(input.chunk.replace(/\s+/g, ""), "base64");

      if (chunk.length === 0 || chunk.length > SOURCE_LIMITS.chunkBytes) throw new GalleyError("invalid", "That part of the upload couldn't be read. Add the file again.");
      let upload = input.uploadId ? uploads.get(input.uploadId) : undefined;

      if (input.uploadId && !upload) throw new GalleyError("not-found", "That upload isn't going on any more. Add the file again.");
      if (!upload) {
        if (input.offset !== 0) throw new GalleyError("invalid", "That upload has to start from the beginning. Add the file again.");
        const existing = await list(siteId);
        const stagedBytes = existing.filter((s) => s.staged).reduce((sum, s) => sum + s.bytes, 0);

        if (existing.length >= SOURCE_LIMITS.count) throw new GalleyError("invalid", `A brand can be set up from at most ${SOURCE_LIMITS.count} files. Remove some first.`);
        if (stagedBytes + input.total > SOURCE_LIMITS.stagedBytes) throw new GalleyError("invalid", `That's more material than can wait to be saved at once (${megabytes(SOURCE_LIMITS.stagedBytes)}). Save the brand, or remove some files first.`);
        const id = randomBytes(8).toString("hex");

        await mkdir(join(dirOf(siteId), "uploads"), { recursive: true });
        upload = { id, path: join(dirOf(siteId), "uploads", `${id}.part`), received: 0, total: input.total, name: input.name, ...(input.note ? { note: input.note } : {}), startedAt: Date.now() };
        await writeFile(upload.path, new Uint8Array(0));
        uploads.set(id, upload);
      }
      if (input.offset !== upload.received) throw new GalleyError("conflict", "Parts of that upload arrived out of order. Add the file again.");
      if (upload.received + chunk.length > upload.total) throw new GalleyError("invalid", "That upload is larger than it said it would be. Add the file again.");
      await appendFile(upload.path, chunk);
      upload.received += chunk.length;
      if (upload.received < upload.total) return { uploadId: upload.id, received: upload.received, source: null };
      uploads.delete(upload.id);
      const finished = upload;

      try {
        const source = await finish(siteId, finished, input.preview);

        await locked(siteId, async () => save(siteId, [...(await list(siteId)), source]));
        return { uploadId: finished.id, received: finished.received, source };
      } catch (error) {
        await rm(finished.path, { force: true });
        throw error;
      }
    },

    /** Adds a record that has no upload (a fetched website). */
    async add(siteId: string, source: StoredSource): Promise<void> {
      await locked(siteId, async () => save(siteId, [...(await list(siteId)), source]));
    },

    async update(siteId: string, id: string, patch: (source: StoredSource) => void): Promise<StoredSource | null> {
      return locked(siteId, async () => {
        const sources = await list(siteId);
        const source = sources.find((s) => s.id === id);

        if (!source) return null;
        patch(source);
        await save(siteId, sources);
        return source;
      });
    },

    async remove(siteId: string, id: string): Promise<StoredSource | null> {
      return locked(siteId, async () => {
        const sources = await list(siteId);
        const source = sources.find((s) => s.id === id);

        if (!source) return null;
        for (const path of [source.bytesPath, source.analysisPath]) if (path) await rm(path, { force: true });
        await save(siteId, sources.filter((s) => s.id !== id));
        return source;
      });
    },

    /** The bytes of a source kept in the app's folder. */
    async bytes(source: StoredSource): Promise<Uint8Array | null> {
      if (!source.bytesPath) return null;
      const info = await stat(source.bytesPath).catch(() => null);

      return info?.isFile() ? new Uint8Array(await readFile(source.bytesPath)) : null;
    },

    async analysisPicture(source: StoredSource): Promise<Uint8Array | null> {
      if (!source.analysisPath) return null;
      const bytes = await readFile(source.analysisPath).catch(() => null);

      return bytes ? new Uint8Array(bytes) : null;
    },

    /** Forgets unfinished uploads older than an hour. */
    async sweep(): Promise<void> {
      for (const [id, upload] of uploads) {
        if (Date.now() - upload.startedAt < 3_600_000) continue;
        uploads.delete(id);
        await rm(upload.path, { force: true });
      }
    },
  };
}

export type SourceStore = ReturnType<typeof createSourceStore>;
