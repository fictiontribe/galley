/**
 * E-mail notifications for new submissions.
 *
 * Delivery is through an SMTP server the operator names once for the whole
 * server: `GALLEY_SMTP_URL` (smtp://user:pass@host:587, or smtps:// for TLS
 * from the start) and `GALLEY_MAIL_FROM` (the sender address). Nodemailer
 * speaks SMTP for us: it is the long-maintained, dependency-free standard for
 * Node, handles STARTTLS, authentication, MIME and header encoding, and an
 * SMTP client is not something to hand-roll for a security-sensitive path.
 *
 * Without both variables there is no transport, and the app says so where
 * notification addresses are set, instead of failing quietly at send time.
 */
import { createTransport } from "nodemailer";
import type { FormDefinition, FormSubmission } from "../kit";
import { isLayoutField } from "./validate";
import { campaignOf } from "./page";

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface MailTransport {
  /** The sender address, shown in the app. */
  readonly from: string;
  send(message: MailMessage): Promise<void>;
}

export interface MailConfig {
  url: string;
  from: string;
}

/** The mail settings from the environment, or null (with the reason) when incomplete. */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv): { config: MailConfig | null; problem: string | null } {
  const url = env.GALLEY_SMTP_URL?.trim() ?? "";
  const from = env.GALLEY_MAIL_FROM?.trim() ?? "";

  if (!url && !from) return { config: null, problem: null };
  if (!url) return { config: null, problem: "GALLEY_MAIL_FROM is set but GALLEY_SMTP_URL isn't, so no e-mail can be sent." };
  if (!from) return { config: null, problem: "GALLEY_SMTP_URL is set but GALLEY_MAIL_FROM isn't, so e-mails would have no sender." };
  if (!/^smtps?:\/\//i.test(url)) return { config: null, problem: "GALLEY_SMTP_URL must start with smtp:// or smtps://." };
  return { config: { url, from }, problem: null };
}

export function createSmtpTransport(config: MailConfig): MailTransport {
  const transport = createTransport(config.url);

  return {
    from: config.from,
    async send(message) {
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });
    },
  };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** One line of header text: no line breaks (header injection), a sane length. */
function headerText(text: string, max = 120): string {
  const flat = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

/** The answers in the form's order with their labels, then anything the form no longer has. */
export function labelledAnswers(form: FormDefinition | null, submission: FormSubmission): Array<{ id: string; label: string; value: string }> {
  const rows: Array<{ id: string; label: string; value: string }> = [];
  const seen = new Set<string>();

  for (const field of (form?.fields ?? []).filter((item) => !isLayoutField(item))) {
    seen.add(field.id);
    const value = submission.values[field.id];

    if (value === undefined) continue;
    rows.push({ id: field.id, label: field.label?.trim() || field.id, value: Array.isArray(value) ? value.join(", ") : value });
  }
  for (const [id, value] of Object.entries(submission.values)) {
    if (!seen.has(id)) rows.push({ id, label: id, value: Array.isArray(value) ? value.join(", ") : value });
  }
  return rows;
}

export function notificationMessage(input: {
  to: string[];
  form: FormDefinition | null;
  formId: string;
  siteName: string;
  submission: FormSubmission;
  inboxUrl: string | null;
}): MailMessage {
  const { form, submission } = input;
  const formName = headerText(form?.name ?? input.formId, 80);
  const answers = labelledAnswers(form, submission);
  const campaign = campaignOf(submission.page?.url);
  const when = new Date(submission.at).toUTCString();
  const emailField = (form?.fields ?? []).find((field) => field.type === "email" && typeof submission.values[field.id] === "string");
  const replyTo = emailField ? String(submission.values[emailField.id]) : undefined;
  const width = Math.min(28, Math.max(...answers.map((row) => row.label.length), 4));
  const text = [
    `New submission to “${formName}” on ${input.siteName}${submission.test ? " (a test)" : ""}`,
    "",
    ...answers.map((row) => `${row.label.padEnd(width)}  ${row.value.replace(/\n/g, `\n${" ".repeat(width + 2)}`)}`),
    "",
    `Received   ${when}`,
    ...(submission.page?.url ? [`Page       ${submission.page.url}`] : []),
    ...(submission.page?.referrer ? [`Came from  ${submission.page.referrer}`] : []),
    ...campaign.map((item) => `${item.key.padEnd(10)} ${item.value}`),
    ...(input.inboxUrl ? ["", `Open it in the inbox: ${input.inboxUrl}`] : []),
    "",
  ].join("\n");
  const cell = "padding:6px 12px 6px 0;vertical-align:top;border-bottom:1px solid #e5e5e5;";
  const html = [
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1a1a1a;">`,
    `<p style="margin:0 0 16px">New submission to <strong>${escapeHtml(formName)}</strong> on ${escapeHtml(input.siteName)}${submission.test ? " (a test)" : ""}.</p>`,
    `<table style="border-collapse:collapse;margin:0 0 16px">`,
    ...answers.map(
      (row) =>
        `<tr><th align="left" style="${cell}font-weight:600;white-space:nowrap">${escapeHtml(row.label)}</th><td style="${cell}white-space:pre-wrap">${escapeHtml(row.value)}</td></tr>`
    ),
    `</table>`,
    `<p style="margin:0 0 4px;color:#555">Received ${escapeHtml(when)}</p>`,
    submission.page?.url ? `<p style="margin:0 0 4px;color:#555">Page: ${escapeHtml(submission.page.url)}</p>` : "",
    submission.page?.referrer ? `<p style="margin:0 0 4px;color:#555">Came from: ${escapeHtml(submission.page.referrer)}</p>` : "",
    ...campaign.map((item) => `<p style="margin:0 0 4px;color:#555">${escapeHtml(item.key)}: ${escapeHtml(item.value)}</p>`),
    input.inboxUrl ? `<p style="margin:16px 0 0"><a href="${escapeHtml(input.inboxUrl)}">Open it in the inbox</a></p>` : "",
    `</body></html>`,
  ].join("");

  return {
    to: input.to,
    subject: headerText(`${submission.test ? "Test: " : ""}New submission to ${formName}`),
    text,
    html,
    ...(replyTo && EMAIL.test(replyTo) ? { replyTo } : {}),
  };
}
