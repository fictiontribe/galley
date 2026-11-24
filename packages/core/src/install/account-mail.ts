/**
 * The two e-mails accounts send: an invitation, and a link to choose a new
 * password. Plain and short, text and simple HTML, through the server's one
 * outgoing mail (forms/mail.ts, GALLEY_SMTP_URL and GALLEY_MAIL_FROM).
 *
 * Each says who it is from (by name, never an address), what it lets the
 * person do, when the link stops working, and that an e-mail nobody expected
 * can be ignored. The product is named by the caller from brand.ts, never
 * here. The link is the only secret in either, and the message is handed to
 * the transport and nowhere else — never to a log.
 */
import type { MailMessage } from "../forms/mail";
import { ROLE_NAMES, type AccountRole } from "./accounts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** One line of header text: no line breaks (header injection), a sane length. */
function headerText(text: string, max = 120): string {
  const flat = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** "25 Nov 2026, 14:05 UTC": the e-mail is read wherever the person is, so the zone is said. */
function when(iso: string): string {
  const date = new Date(iso);

  return `${date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

function html(paragraphs: string[], link: { url: string; label: string }): string {
  return [
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1a1a1a;">`,
    ...paragraphs.slice(0, 1).map((text) => `<p style="margin:0 0 16px">${escapeHtml(text)}</p>`),
    `<p style="margin:0 0 16px"><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`,
    ...paragraphs.slice(1).map((text) => `<p style="margin:0 0 12px;color:#555">${escapeHtml(text)}</p>`),
    `</body></html>`,
  ].join("");
}

export interface InvitationEmailInput {
  to: string;
  /** The product's name (brand.ts). */
  product: string;
  /** The editor's address, so the person knows which one this is. */
  address: string;
  invitedBy: string;
  role: AccountRole;
  url: string;
  expiresAt: string;
}

export function invitationEmail(input: InvitationEmailInput): MailMessage {
  const role = ROLE_NAMES[input.role];
  const host = new URL(input.address).host;
  const first = `${input.invitedBy} invited you to edit the site at ${host} with ${input.product}, as ${/^[AEIOU]/.test(role) ? "an" : "a"} ${role}.`;
  const rest = [
    `Open the link to choose your name and a password. It works once, until ${when(input.expiresAt)}.`,
    "If you didn't expect this e-mail, you can ignore it: nothing happens until the link is opened.",
  ];

  return {
    to: [input.to],
    subject: headerText(`${input.invitedBy} invited you to edit ${host}`),
    text: [first, "", input.url, "", ...rest.flatMap((line) => [line, ""])].join("\n"),
    html: html([first, ...rest], { url: input.url, label: "Accept the invitation" }),
  };
}

export interface PasswordLinkEmailInput {
  to: string;
  product: string;
  address: string;
  url: string;
  expiresAt: string;
  /** An owner made the link for them; absent: they asked for it themselves. */
  madeBy?: string;
}

export function passwordLinkEmail(input: PasswordLinkEmailInput): MailMessage {
  const host = new URL(input.address).host;
  const first = input.madeBy
    ? `${input.madeBy} made you a link to choose a new password for ${input.product} at ${host}.`
    : `Someone asked for a link to choose a new password for ${input.product} at ${host}.`;
  const rest = [
    `It works once, until ${when(input.expiresAt)}. Your current password keeps working until the link is used.`,
    "If you didn't ask for this, you can ignore this e-mail: nothing changes unless the link is opened.",
  ];

  return {
    to: [input.to],
    subject: headerText(`Choose a new password for ${host}`),
    text: [first, "", input.url, "", ...rest.flatMap((line) => [line, ""])].join("\n"),
    html: html([first, ...rest], { url: input.url, label: "Choose a new password" }),
  };
}
