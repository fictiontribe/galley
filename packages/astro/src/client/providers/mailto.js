// @ts-check
// The last resort: opens the visitor's own mail program with the answers in a
// new message. Nothing is stored and the page can't know whether the message
// was sent — only that the mail program was asked to open.

/** @type {import("../types").Submitter} */
export function submit(_values, destination, context) {
  const to = typeof destination.settings.to === "string" ? destination.settings.to : "";

  if (!to) return { ok: false, notConnected: true, detail: "The mail destination needs settings.to." };
  const subject = typeof destination.settings.subject === "string" ? destination.settings.subject : "";
  const lines = context.items.map(({ field, value }) => `${field.label ?? field.id}: ${Array.isArray(value) ? value.join(", ") : value}`);

  for (const [name, value] of Object.entries(destination.constants ?? {})) lines.push(`${name}: ${value}`);
  const query = [subject ? `subject=${encodeURIComponent(subject)}` : "", `body=${encodeURIComponent(lines.join("\n"))}`].filter(Boolean).join("&");

  location.href = `mailto:${to}?${query}`;
  return { ok: true, detail: "Asked the mail program to open." };
}
