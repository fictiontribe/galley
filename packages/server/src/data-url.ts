import { invalid } from "./errors";
import { UPLOAD_TYPES } from "./mime";

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Decodes a `data:` URL carrying an upload. Refuses anything that isn't an
 * image, an MP4 video or a PDF, and anything over the size limit — checked
 * on the encoded length first so an oversized upload is never decoded.
 */
export function decodeMediaDataUrl(value: string, limit = MAX_MEDIA_BYTES): { mime: string; data: Uint8Array } {
  const match = /^data:([^;,]*)((?:;[^;,=]+=[^;,]*)*)(;base64)?,/i.exec(value);

  if (!match) throw invalid("That upload couldn't be read. Choose the file again.");
  const mime = (match[1] || "text/plain").trim().toLowerCase();

  if (!(mime in UPLOAD_TYPES)) {
    throw invalid("Only images, MP4 videos, and PDFs can be added to media.", `Received ${mime}.`);
  }
  const payload = value.slice(match[0].length);
  const base64 = Boolean(match[3]);
  const estimated = base64 ? Math.floor((payload.length * 3) / 4) : payload.length;
  const tooLarge = () => invalid(`That file is too large. Media files can be up to ${megabytes(limit)}.`);

  if (estimated > limit + 3) throw tooLarge();
  let data: Uint8Array;

  if (base64) {
    const clean = payload.replace(/\s+/g, "");

    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw invalid("That upload couldn't be read. Choose the file again.");
    data = Buffer.from(clean, "base64");
  } else {
    try {
      data = Buffer.from(decodeURIComponent(payload), "utf8");
    } catch {
      throw invalid("That upload couldn't be read. Choose the file again.");
    }
  }
  if (data.byteLength > limit) throw tooLarge();
  if (data.byteLength === 0) throw invalid("That file is empty.");
  return { mime, data };
}
