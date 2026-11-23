import { appendFileSync, readFileSync, statSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FormSubmission } from "../../src/kit";
import { createIdMinter, idTime, SUBMISSION_ID } from "../../src/forms/ids";
import { SubmissionStore } from "../../src/forms/store";
import { csvCell, submissionsCsv, CSV_BOM } from "../../src/forms/csv";
import { contactForm, SITE_ID, tempHome } from "./helpers";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function store() {
  const { home, cleanup } = tempHome();

  cleanups.push(cleanup);
  return { home, store: new SubmissionStore(home) };
}

const mint = createIdMinter();

function submission(values: FormSubmission["values"], extra: Partial<FormSubmission> = {}): FormSubmission {
  return { id: mint(), siteId: SITE_ID, form: "contact", at: new Date().toISOString(), values, read: false, ...extra };
}

describe("ids", () => {
  it("sort by time, even within one millisecond", () => {
    const minter = createIdMinter();
    const ids = [minter(1000), minter(1000), minter(1000), minter(999), minter(2000)];

    expect([...ids].sort()).toEqual(ids);
    expect(ids.every((id) => SUBMISSION_ID.test(id))).toBe(true);
    expect(idTime(ids[4]!)).toBe(2000);
  });
});

describe("SubmissionStore", () => {
  it("writes one line per submission under <home>/state/<siteId>/submissions, readable by this user only", async () => {
    const { home, store: s } = store();

    await s.append(submission({ name: "Ada" }));
    const file = `${home}/state/${SITE_ID}/submissions/contact.jsonl`;

    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(`${home}/state/${SITE_ID}/submissions`).mode & 0o777).toBe(0o700);
  });

  it("keeps every line intact under many concurrent appends and updates", async () => {
    const { home, store: s } = store();
    const items = Array.from({ length: 200 }, (_, index) => submission({ name: `Visitor ${index}`, message: "x".repeat(index * 10) }));

    await Promise.all(items.map((item, index) => (index % 3 === 0 ? s.append(item).then(() => s.update(SITE_ID, "contact", [item.id], (it) => ({ ...it, read: true }))) : s.append(item))));
    const lines = readFileSync(`${home}/state/${SITE_ID}/submissions/contact.jsonl`, "utf8").trim().split("\n");

    expect(lines).toHaveLength(200);
    const parsed = lines.map((line) => JSON.parse(line) as FormSubmission);

    expect(new Set(parsed.map((item) => item.id)).size).toBe(200);
    expect(parsed.filter((item) => item.read).length).toBe(67);
    // A second store (another process start) reads the same.
    expect((await new SubmissionStore(home).list(SITE_ID, "contact")).length).toBe(200);
  });

  it("deletes for good, restores for Undo, and removes the file when the last one goes", async () => {
    const { home, store: s } = store();
    const a = submission({ name: "A" });
    const b = submission({ name: "B" });

    await s.append(a);
    await s.append(b);
    const removed = await s.remove(SITE_ID, "contact", [a.id]);

    expect(removed.map((item) => item.id)).toEqual([a.id]);
    expect(readFileSync(`${home}/state/${SITE_ID}/submissions/contact.jsonl`, "utf8")).not.toContain('"A"');
    expect(await s.restore(SITE_ID, "contact", removed)).toBe(1);
    expect((await s.list(SITE_ID, "contact")).map((item) => item.id)).toEqual([a.id, b.id]);
    expect(await s.restore(SITE_ID, "contact", removed)).toBe(0);
    await s.remove(SITE_ID, "contact", [a.id, b.id]);
    expect(await s.formIds(SITE_ID)).toEqual([]);
  });

  it("keeps a line it can't read instead of dropping it on the next rewrite", async () => {
    const { home, store: s } = store();
    const a = submission({ name: "A" });

    await s.append(a);
    appendFileSync(`${home}/state/${SITE_ID}/submissions/contact.jsonl`, '{"id":"half-writ');
    await s.update(SITE_ID, "contact", [a.id], (item) => ({ ...item, read: true }));
    expect(readFileSync(`${home}/state/${SITE_ID}/submissions/contact.jsonl`, "utf8")).toContain('{"id":"half-writ');
    expect(await s.list(SITE_ID, "contact")).toHaveLength(1);
  });

  it("refuses ids that would leave its folder", async () => {
    const { store: s } = store();

    await expect(s.list("../etc", "contact")).rejects.toThrow(/isn't open here/);
    await expect(s.list(SITE_ID, "../../secrets")).rejects.toThrow(/no such form/);
  });
});

describe("CSV export", () => {
  it("uses the form's order and labels, escapes properly, starts with a BOM, and defuses formulas", () => {
    const form = contactForm();
    const items = [
      submission({ name: "Zoë, “the boss”", email: "z@example.com", message: 'Line one\nLine "two"' }, { page: { url: "https://example.com/contact/?utm_source=news" } }),
      submission({ name: "=HYPERLINK(\"http://evil\")", email: "x@example.com", topic: "sales", legacy: ["a", "b"] }, { spam: true }),
    ];
    const csv = submissionsCsv(form, items);

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");

    expect(lines[0]).toBe("Received,Your name,E-mail,Topic,Message,legacy,Page,Referrer,Spam");
    expect(lines[1]).toContain('"Zoë, “the boss”",z@example.com,,"Line one\nLine ""two""",,https://example.com/contact/?utm_source=news,,');
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://evil"")",x@example.com,sales,,a; b,,,yes`);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("csvCell", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@x")).toBe("'@x");
  });
});
