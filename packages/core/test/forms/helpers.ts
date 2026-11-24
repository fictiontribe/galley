import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FormDefinition } from "../../src/kit";
import type { EventBus, ServerEvent, SiteModel, SiteService } from "../../src/types";

export const SITE_ID = "a1b2c3d4e5f6";

export function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "galley-forms-"));

  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export function contactForm(overrides: Partial<FormDefinition> = {}): FormDefinition {
  return {
    name: "Contact us",
    fields: [
      { id: "name", type: "text", label: "Your name", required: true },
      { id: "email", type: "email", label: "E-mail", required: true },
      { id: "topic", type: "select", label: "Topic", options: [{ value: "sales", label: "Sales" }, { value: "help", label: "Help" }] },
      { id: "message", type: "textarea", label: "Message" },
    ],
    submitLabel: "Send",
    destinations: [{ provider: "galley", settings: {} }],
    afterSubmit: [{ type: "message", text: "Thanks." }],
    ...overrides,
  };
}

/**
 * A site with a `forms` collection whose working copy and published copy are
 * plain maps — exactly the SiteService methods the capture service uses
 * (and the preview's address, which marks a submission as a test).
 */
export function fakeSite(input: {
  id?: string;
  working?: Record<string, FormDefinition | string>;
  published?: Record<string, FormDefinition | string>;
  urls?: SiteModel["urls"];
  name?: string;
  /** Origin of the site's running preview, when there is one. */
  previewUrl?: string | null;
}): SiteService & { working: Map<string, string>; published: Map<string, string> } {
  const dir = "src/content/forms";
  const text = (value: FormDefinition | string) => (typeof value === "string" ? value : JSON.stringify(value));
  const working = new Map(Object.entries(input.working ?? {}).map(([id, value]) => [`${dir}/${id}.json`, text(value)]));
  const published = new Map(Object.entries(input.published ?? {}).map(([id, value]) => [`${dir}/${id}.json`, text(value)]));
  const model = {
    name: input.name ?? "Harbour Café",
    urls: input.urls ?? { production: "https://example.com" },
    collections: [{ id: "forms", path: dir, label: "Forms", kind: "data", format: "json" }],
  } as unknown as SiteModel;
  const site = {
    id: input.id ?? SITE_ID,
    root: "/tmp/fake-site",
    working,
    published,
    model: async () => model,
    listEntries: async () => {
      const items = [...working.keys()].sort().map((path) => ({ path, slug: path.slice(dir.length + 1, -5), collection: "forms", title: path, titleSource: "filename", url: null, status: "clean", modifiedAt: 0 }));

      return { collection: "forms", total: items.length, items };
    },
    readFile: async (path: string) => {
      const content = working.get(path);

      if (content === undefined) throw new Error(`missing ${path}`);
      return { path, content, hash: "h", binary: false };
    },
    readBase: async (path: string) => {
      const content = published.get(path);

      return content === undefined ? null : new TextEncoder().encode(content);
    },
    preview: () => ({ status: () => ({ state: input.previewUrl ? "ready" : "idle", url: input.previewUrl ?? null, baselineUrl: null, baselineSource: null, log: [] }) }),
  };

  return site as unknown as SiteService & { working: Map<string, string>; published: Map<string, string> };
}

export function recordingBus(): EventBus & { events: ServerEvent[] } {
  const events: ServerEvent[] = [];

  return {
    events,
    emit: (event) => void events.push(event),
    subscribe: () => () => {},
  };
}

export interface FakeSmtp {
  port: number;
  messages: Array<{ from: string; to: string[]; data: string }>;
  close(): Promise<void>;
}

/**
 * Enough of an SMTP server for nodemailer to deliver one message: EHLO,
 * MAIL FROM, RCPT TO, DATA, QUIT. No TLS, no auth. Never relays anything.
 */
export function fakeSmtp(): Promise<FakeSmtp> {
  const messages: FakeSmtp["messages"] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    let current = { from: "", to: [] as string[], data: "" };
    const reply = (line: string) => socket.write(`${line}\r\n`);

    reply("220 fake.smtp ready");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");

          if (end === -1) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          messages.push(current);
          current = { from: "", to: [], data: "" };
          reply("250 queued");
          continue;
        }
        const eol = buffer.indexOf("\r\n");

        if (eol === -1) return;
        const line = buffer.slice(0, eol);

        buffer = buffer.slice(eol + 2);
        const verb = line.slice(0, 4).toUpperCase();

        if (verb === "EHLO" || verb === "HELO") reply("250 fake.smtp");
        else if (verb === "MAIL") (current.from = line.replace(/^MAIL FROM:\s*/i, "")), reply("250 ok");
        else if (verb === "RCPT") current.to.push(line.replace(/^RCPT TO:\s*/i, "")), reply("250 ok");
        else if (verb === "DATA") (inData = true), reply("354 go ahead");
        else if (verb === "QUIT") reply("221 bye"), socket.end();
        else if (verb === "RSET" || verb === "NOOP") reply("250 ok");
        else reply("502 not implemented");
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;

      resolve({
        port,
        messages,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
