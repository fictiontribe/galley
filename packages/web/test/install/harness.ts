/**
 * Renders the real app in happy-dom against the in-process mock server: a
 * stubbed `fetch` and `EventSource` reach `mock/server.ts`, whose request
 * log the tests read. Each `renderApp` loads the app's modules fresh, so
 * stores, caches and the setup code start empty.
 */
import { URL as NodeURL } from "node:url";
import { vi } from "vitest";
import type { InstallFixed, InstallSite } from "@galley/core/install/types";
import type { ServerEvent } from "@galley/core/types";

/**
 * The mock server (mock/server.ts) and the app are loaded by dynamic import:
 * their types come from the server's world and the browser's respectively,
 * which don't check together. These are the parts the tests use.
 */
export interface MockLogEntry {
  method: string;
  path: string;
  search: string;
  route: string | null;
  status: number;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
  /** Refused because the signed-in person's role may not call the route. */
  refused?: boolean;
}

/** One person in the mock (mock/accounts.ts), password included. */
export interface MockPerson {
  id: string;
  name: string;
  email: string;
  role: "owner" | "editor" | "contributor";
  disabled: boolean;
  incomplete?: boolean;
  password: string;
}

export interface MockAccountsState {
  accounts: MockPerson[];
  invitations: Array<{ id: string; email: string; role: string; emailed: boolean }>;
  outbox: Array<{ to: string; kind: "invitation" | "password"; url: string }>;
  signedIn: string | null;
  emailAvailable: boolean;
  /** The sign-in limits' clock: move it on to let a wait run out. */
  now: () => number;
  current(): MockPerson | null;
}

export interface MockServer {
  log: MockLogEntry[];
  backend: { authenticated: boolean; sites: Map<string, { id: string; name: string }> };
  install: { site: InstallSite; code: string | null; password: string | null; keyAccepted: boolean; lastBackupAt: string | null } | null;
  accounts: MockAccountsState | null;
  handle(request: { method: string; url: string; headers: Record<string, string | undefined>; body?: Buffer }): Promise<{ status: number; headers: Record<string, string>; body: string | Buffer | null; sse?: boolean }>;
  onEvent(listener: (event: ServerEvent) => void): () => void;
}

export interface MockServerOptions {
  mode: "local" | "hosted";
  setup?: "password" | "site" | "details" | "done";
  fixed?: InstallFixed[];
  stepMs?: number;
  allowLocalRepositories?: boolean;
  address?: string;
  /** Start signed in as the first person with this role. */
  role?: "owner" | "editor" | "contributor";
  /** The server has outgoing e-mail. */
  email?: boolean;
  /** false: the server has no public address of its own, so it e-mails no link. */
  publicAddress?: boolean;
  /** An install from before accounts. */
  legacy?: boolean;
  /** false: a server from before accounts (one shared password). */
  accounts?: boolean;
  /** An identity provider set up (see mock/accounts.ts). */
  provider?: { name: string; passwordsOff?: boolean; people?: string[] };
  /** Replace or wrap some answers (mock/server.ts `handlers`): the handlers are the mock's own, typed loosely here. */
  handlers?: (handlers: Record<string, (request: any) => unknown>, backend: { emit(event: ServerEvent): void }) => Record<string, (request: any) => unknown>;
}

/** Every request the mock refused because the signed-in person's role may not make it. */
export function refusals(server: MockServer): string[] {
  return server.log.filter((entry) => entry.refused).map((entry) => `${entry.method} ${entry.path}`);
}

const MOCK_SERVER = "../../mock/server.ts";
const APP = "../../src/app/App.tsx";

// happy-dom's URL resolves a file: base against the page, which breaks the
// mock's fixture paths; Node's URL does what both the mock and the app need.
globalThis.URL = NodeURL as unknown as typeof URL;


async function bodyBytes(body: unknown): Promise<Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof (body as Blob).arrayBuffer === "function") return Buffer.from(await (body as Blob).arrayBuffer());
  throw new Error(`The test fetch can't send a ${typeof body} body`);
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!headers) return out;
  if (Array.isArray(headers)) for (const [name, value] of headers) out[name.toLowerCase()] = value;
  else if (typeof (headers as Headers).forEach === "function") (headers as Headers).forEach((value, name) => (out[name.toLowerCase()] = value));
  else for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = value;
  return out;
}

/** What a test gets: the mock (its log and state), the page, and helpers. */
export interface Rendered {
  server: MockServer;
  container: HTMLElement;
  text: () => string;
  unmount: () => Promise<void>;
}

/** Saved files from the backup download: the anchor clicks the app made. */
export const saved: Array<{ name: string; size: number }> = [];

export async function startServer(options: MockServerOptions): Promise<MockServer> {
  const { createMockServer } = (await import(/* @vite-ignore */ MOCK_SERVER)) as { createMockServer: (options: MockServerOptions) => MockServer };
  const server = createMockServer({ stepMs: 5, ...options });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const answer = await server.handle({ method: init?.method ?? "GET", url, headers: headerRecord(init?.headers), body: await bodyBytes(init?.body) });
    return new Response(answer.body === null ? null : typeof answer.body === "string" ? answer.body : new Uint8Array(answer.body), { status: answer.status, headers: answer.headers });
  });
  class FakeEventSource {
    onopen: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private readonly stop: () => void;
    constructor() {
      this.stop = server.onEvent((event: ServerEvent) => this.onmessage?.({ data: JSON.stringify(event) }));
      queueMicrotask(() => this.onopen?.());
    }
    close(): void {
      this.stop();
    }
  }
  vi.stubGlobal("EventSource", FakeEventSource);
  // Downloads: record what the app hands the browser instead of navigating.
  URL.createObjectURL = (blob: Blob) => `blob:test/${blob.size}`;
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    if (this.download) saved.push({ name: this.download, size: Number(this.href.split("/").pop()) });
  };
  return server;
}

/** Load the app fresh at `path` and render it. */
export async function renderApp(server: MockServer, path: string): Promise<Rendered> {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", path);
  const [{ createElement, act }, { createRoot }, { App }] = await Promise.all([import("react"), import("react-dom/client"), import(/* @vite-ignore */ APP) as Promise<{ App: () => null }>]);
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(App)));
  return {
    server,
    container,
    text: () => document.body.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

/**
 * Let React and the mock settle: run `check` until it stops throwing (or give
 * up after `timeout` ms). It returns the moment the check passes, so the
 * generous limit costs nothing when things work — and a loaded machine (a
 * busy CI runner) needs far more than the fraction of a second this takes
 * on an idle one.
 */
export async function until(check: () => void, timeout = 15_000): Promise<void> {
  const { act } = await import("react");
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeout) {
    try {
      check();
      return;
    } catch (error) {
      last = error;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw last;
}

/** Settle for a moment (requests in flight, lazy screens). */
export async function settle(ms = 150): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** A button or link by its visible name. */
export function byText<T extends HTMLElement = HTMLElement>(container: ParentNode, selector: string, text: string | RegExp): T | null {
  const match = (value: string) => (typeof text === "string" ? value.trim() === text : text.test(value));
  return ([...container.querySelectorAll<T>(selector)].find((element) => match(element.textContent ?? "") || match(element.getAttribute("aria-label") ?? "")) ?? null) as T | null;
}

/** Click, the way a person does, inside act. */
export async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error("Nothing to click");
  const { act } = await import("react");
  await act(async () => {
    (element as HTMLElement).click();
  });
}

/** Type into an input or textarea so React sees it. */
export async function type(element: Element | null, value: string): Promise<void> {
  if (!element) throw new Error("Nothing to type into");
  const { act } = await import("react");
  const input = element as HTMLInputElement;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The input labelled `label` (the Field component wires label-for). */
export function field(container: ParentNode, label: string | RegExp): HTMLInputElement | null {
  const labels = [...container.querySelectorAll("label")].filter((element) => (typeof label === "string" ? element.textContent?.trim() === label : label.test(element.textContent ?? "")));
  for (const element of labels) {
    const id = element.getAttribute("for");
    const target = id ? document.getElementById(id) : element.querySelector("input, textarea");
    if (target) return target as HTMLInputElement;
  }
  return null;
}

/** Submit the form holding `element`. */
export async function submit(element: Element | null): Promise<void> {
  const form = element?.closest("form");
  if (!form) throw new Error("No form to submit");
  const { act } = await import("react");
  await act(async () => {
    form.requestSubmit();
  });
}
