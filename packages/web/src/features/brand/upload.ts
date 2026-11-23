/**
 * Adding material: each file goes up in chunks (large guideline PDFs fit
 * under the server's request limit), and pictures the engine can't decode
 * itself (JPG, WebP, GIF) travel with a PNG copy made here, in the browser,
 * shrunk to the size the model reads — so the engine re-encodes from pixels
 * and never has to trust the original file's bytes.
 */
import type { BrandSource } from "@galley/core/sitebrand/types";
import { api } from "@/lib/api";

const CHUNK = 6 * 1024 * 1024;
const MODEL_EDGE = 1568;

function base64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;

  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

/** A PNG copy of a picture, shrunk to the model's size, as a data: URL — or null when the browser can't read it. */
export async function pngCopy(file: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MODEL_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export interface UploadProgress {
  name: string;
  fraction: number;
}

export async function uploadSource(siteId: string, file: File, note: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<BrandSource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const needsCopy = /^image\/(jpeg|webp|gif|avif|bmp)$/.test(file.type) || /\.(jpe?g|webp|gif|avif)$/i.test(file.name);
  const preview = needsCopy ? await pngCopy(file) : null;
  let uploadId: string | undefined;

  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const part = bytes.subarray(offset, offset + CHUNK);
    const last = offset + part.length >= bytes.length;
    const result = await api("POST /api/sites/:siteId/brand/sources", {
      params: { siteId },
      body: { name: file.name, total: bytes.length, offset, chunk: base64(part), ...(uploadId ? { uploadId } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(last && preview ? { preview } : {}) },
      ...(signal ? { signal } : {}),
    });

    uploadId = result.uploadId;
    onProgress(Math.min(1, (offset + part.length) / bytes.length));
    if (result.source) return result.source;
  }
  throw new Error("The upload ended without the file being taken.");
}

/** What kind of file it looks like before it is sent (the server decides for real, from the bytes). */
export function guessKind(file: File): "pdf" | "image" | "svg" | "text" | null {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return "svg";
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)) return "image";
  if (file.type.startsWith("text/") || /\.(md|markdown|txt)$/i.test(file.name)) return "text";
  return null;
}
