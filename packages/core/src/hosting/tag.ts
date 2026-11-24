/**
 * How what this app creates is marked as one install's own, so removing it
 * can tell it apart from anything that merely has a similar name: Fly.io
 * machines carry `<slug>_install: <name>` in their metadata; DNS records
 * carry a comment that names the install (Cloudflare allows 100 characters
 * in a comment on every plan).
 */
import { PRODUCT } from "../brand";

export const TAG_KEY = `${PRODUCT.slug}_install`;

export function recordComment(name: string): string {
  return `${PRODUCT.slug}-install=${name} (made by ${PRODUCT.name}; removed with the editor)`;
}
