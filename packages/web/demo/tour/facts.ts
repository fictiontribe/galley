/**
 * The facts the walkthrough moves on (steps.ts `Facts`), read from the
 * demo's own server and the app's address, and refreshed whenever either
 * changes. The one thing the server can't tell — that a change was made by
 * retyping on the page — comes from the overlay's own message to the app.
 */
import { useEffect, useState } from "react";
import type { ChangeSet, ServerEvent } from "@galley/core/types";
import type { MockServer } from "../../mock/server.ts";
import { RECORDED_EDIT } from "../assistant";
import { HOME_PAGE, type Facts } from "./steps";
import { useTour } from "./store";

/** The app's route and query from the hash: "#/sites/caddow/edit?path=…" → route and entry path. */
export function routeOf(hash: string): { route: string; entryPath: string | null } {
  const text = hash.replace(/^#/, "") || "/";
  const [path = "/", query = ""] = text.split("?");
  return { route: path, entryPath: new URLSearchParams(query).get("path") };
}

/** Unpublished changes, counted as the visitor sees them in Proof: each changed field, or the file when it has none. */
export function pendingOf(changes: ChangeSet): number {
  return changes.files.reduce((sum, file) => sum + Math.max(1, file.fieldChanges?.length ?? 0), 0);
}

export function headingChangedIn(changes: ChangeSet): boolean {
  return changes.files.some((file) => (file.fieldChanges ?? []).some((change) => ["heading", "title"].includes(String(change.field[change.field.length - 1]))));
}

export function readFacts(server: MockServer, siteId: string, hash: string, pageEdited: boolean, sampleVersions: number): Facts {
  const site = server.backend.sites.get(siteId);
  const { route, entryPath } = routeOf(hash);
  if (!site) return { route, entryPath, pending: 0, headingChanged: false, pageEdited, assistantChanged: false, published: 0 };
  const changes = site.changes();
  const home = site.read(HOME_PAGE)?.toString("utf8") ?? "";
  return {
    route,
    entryPath,
    pending: pendingOf(changes),
    headingChanged: headingChangedIn(changes),
    pageEdited,
    // The recorded answer's words are on the home page (it may since have been published).
    assistantChanged: home.includes(RECORDED_EDIT.value),
    // Publishing and undoing a publish each add a version to the ones the sample site came with.
    published: Math.max(0, site.history.length - sampleVersions),
  };
}

export function useFacts(server: MockServer, siteId: string, sampleVersions: number): Facts {
  const pageEdited = useTour((s) => s.pageEdited);
  const markPageEdited = useTour((s) => s.markPageEdited);
  const [hash, setHash] = useState(() => window.location.hash);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    // The app's router changes the address with history.pushState, which fires no hashchange.
    const timer = setInterval(onHash, 300);
    return () => {
      window.removeEventListener("hashchange", onHash);
      clearInterval(timer);
    };
  }, []);

  useEffect(
    () =>
      server.onEvent((event: ServerEvent) => {
        if (event.type === "changes.updated" || event.type === "site.updated") setTick((n) => n + 1);
      }),
    [server],
  );

  useEffect(() => {
    // The overlay tells the app a text was retyped in place; the save that follows is a change like any other.
    let retyped = 0;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { galley?: number; type?: string; text?: string; newText?: string } | null;
      if (event.origin !== window.location.origin || data?.galley !== 1 || data.type !== "edit" || data.text === data.newText) return;
      retyped = Date.now();
    };
    const stop = server.onEvent((event) => {
      if (event.type === "changes.updated" && event.origin === "user" && Date.now() - retyped < 5000) markPageEdited();
    });
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      stop();
    };
  }, [server, markPageEdited]);

  // `tick` is read so the facts are re-read after every change on the server.
  void tick;
  return readFacts(server, siteId, hash, pageEdited, sampleVersions);
}
