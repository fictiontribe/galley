/**
 * The check Galley runs before it saves a store's settings, and again from
 * Media › Storage or `galley media check`: everything the site will need,
 * done for real with a tiny test picture, in order, stopping at the first
 * failure with a sentence that says what to change.
 *
 *   reach   the service answers and the key may look
 *   write   a test picture is stored under a new name
 *   read    it reads back byte for byte
 *   list    the site's files can be listed (stores that list)
 *   public  visitors can load it from the public address, with no key
 *   delete  it is removed again
 *
 * The test picture is removed even when a step after `write` fails; if that
 * removal fails too, the result says which name was left behind.
 */
import { randomBytes } from "node:crypto";
import type { MediaCheckResult, MediaCheckStep, MediaCheckStepId } from "./contract";
import { StoreError, type MediaStore, type PublicProblem, type StoredItem } from "./store";

/** A 1×1 PNG (67 bytes). Every store takes it, Cloudflare Images included. */
export const TEST_PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
);

export const CHECK_LABELS: Record<MediaCheckStepId, string> = {
  settings: "The settings make sense",
  reach: "Reach the service",
  write: "Store a test picture",
  read: "Read it back",
  list: "List the site's files",
  public: "Load it from the public address",
  delete: "Remove the test picture",
};

export interface CheckOptions {
  /** The name to store the test picture under ("lowfield/.galley-check-….png"); a random one when absent. */
  testName?: string;
  /** fetch for the public address (no credentials are ever sent there). */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The settings step's own failure, before any store is made. */
export function settingsFailure(problems: Array<{ field: MediaCheckStep["field"]; message: string }>): MediaCheckResult {
  const first = problems[0]!;
  const steps: MediaCheckStep[] = [
    { id: "settings", label: CHECK_LABELS.settings, state: "failed", message: problems.map((p) => p.message).join(" "), ...(first.field ? { field: first.field } : {}) },
  ];

  return { ok: false, steps, message: first.message };
}

export function testNameFor(prefix: string): string {
  return `${prefix}galley-check-${randomBytes(6).toString("hex")}.png`;
}

export async function runCheck(store: MediaStore, options: CheckOptions = {}): Promise<MediaCheckResult> {
  const steps: MediaCheckStep[] = [{ id: "settings", label: CHECK_LABELS.settings, state: "ok" }];
  const order: MediaCheckStepId[] = ["reach", "write", "read", "list", "public", "delete"];
  const doFetch = options.fetch ?? fetch;
  let stored: StoredItem | null = null;
  let failure: { step: MediaCheckStepId; message: string; detail?: string } | null = null;

  const fail = (step: MediaCheckStepId, error: unknown) => {
    const explained = error instanceof StoreError ? error : new StoreError(error instanceof Error ? error.message : String(error), { step });

    steps.push({ id: step, label: CHECK_LABELS[step], state: "failed", message: explained.message, ...(explained.field ? { field: explained.field } : {}) });
    failure = { step, message: explained.message, ...(explained.detail ? { detail: explained.detail } : {}) };
  };

  for (const step of order) {
    if (failure) {
      steps.push({ id: step, label: CHECK_LABELS[step], state: "skipped" });
      continue;
    }
    try {
      switch (step) {
        case "reach":
          await store.reach();
          break;
        case "write":
          stored = await store.put({ name: options.testName ?? testNameFor(""), data: TEST_PNG, type: "image/png", width: 1, height: 1 });
          break;
        case "read": {
          const bytes = await store.get(stored!.key);

          if (!bytes) throw new StoreError("The test picture was stored but can't be found again. The service may still be catching up: check again in a minute.", { step });
          if (store.abilities.address === "key" && !sameBytes(bytes, TEST_PNG)) throw new StoreError("The test picture came back different from what was stored.", { step });
          break;
        }
        case "list":
          if (!store.abilities.canList || !store.list) {
            steps.push({ id: step, label: CHECK_LABELS[step], state: "skipped" });
            continue;
          }
          await store.list();
          break;
        case "public":
          await checkPublic(store, stored!, doFetch, options.timeoutMs ?? 20_000);
          break;
        case "delete":
          await store.delete(stored!.key);
          stored = null;
          break;
      }
      steps.push({ id: step, label: CHECK_LABELS[step], state: "ok" });
    } catch (error) {
      fail(step, error);
    }
  }
  if (stored) {
    // A step after `write` failed: remove the test picture all the same.
    const left = stored as StoredItem;

    try {
      await store.delete(left.key);
    } catch {
      const at = steps.find((s) => s.state === "failed");

      if (at) at.message = `${at.message} The test picture “${left.key}” couldn't be removed either; delete it on the service's side.`;
    }
  }
  if (!failure) return { ok: true, steps };
  const { message, detail } = failure as { message: string; detail?: string };

  return { ok: false, steps, message, ...(detail ? { detail } : {}) };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));
}

async function checkPublic(store: MediaStore, item: StoredItem, doFetch: typeof fetch, timeoutMs: number): Promise<void> {
  const url = store.urlOf(item.key);
  const problem = (kind: PublicProblem, detail?: string) =>
    new StoreError(store.publicProblem?.(kind, url) ?? `The public address doesn't serve the test picture (${kind}).`, { step: "public", field: "publicUrl", ...(detail ? { detail } : {}) });
  let response: Response;

  try {
    response = await doFetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw problem("unreachable", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
  const detail = `${response.status} from ${url}`;

  if (response.status === 404) throw problem("missing", detail);
  if (response.status === 401 || response.status === 403) throw problem("refused", detail);
  if (!response.ok) throw problem("unreachable", detail);
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (store.abilities.address === "key") {
    if (!sameBytes(bytes, TEST_PNG)) throw problem("different", detail);
  } else if (!(response.headers.get("content-type") ?? "").startsWith("image/")) {
    throw problem("different", `${detail}, ${response.headers.get("content-type") ?? "no content type"}`);
  }
}
