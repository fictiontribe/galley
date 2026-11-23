/**
 * What can be attached to a message: images only, a few at a time, each
 * within a size the server will take. Problems are said plainly, per file.
 */
import { bytes } from "@/lib/format";

export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"];

/** The one-line rule, shown beside the attach button. */
export const ATTACHMENT_RULE = `Images only — up to ${MAX_ATTACHMENTS} at a time, ${bytes(MAX_ATTACHMENT_BYTES)} each`;

export interface CandidateFile {
  name: string;
  type: string;
  size: number;
}

export interface AttachmentCheck<T extends CandidateFile> {
  accepted: T[];
  /** Sentences, one per refused file. */
  problems: string[];
}

export function checkAttachments<T extends CandidateFile>(files: T[], alreadyAttached: number): AttachmentCheck<T> {
  const accepted: T[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const name = file.name || "That file";
    if (!ACCEPTED_TYPES.includes(file.type)) {
      problems.push(`“${name}” isn’t an image. Attach PNG, JPG, WebP, GIF, AVIF or SVG files.`);
      continue;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      problems.push(`“${name}” is ${bytes(file.size)}, larger than ${bytes(MAX_ATTACHMENT_BYTES)}. Make it smaller and attach it again.`);
      continue;
    }
    if (alreadyAttached + accepted.length >= MAX_ATTACHMENTS) {
      problems.push(`Only ${MAX_ATTACHMENTS} images fit in one message, so “${name}” wasn’t added.`);
      continue;
    }
    accepted.push(file);
  }
  return { accepted, problems };
}
