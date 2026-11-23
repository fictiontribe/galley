import { useCallback, useEffect, useReducer } from "react";
import type { ChatThread } from "@galley/core/types";
import { api, isApiFailure } from "@/lib/api";
import { onReconnect, useServerEvent } from "@/lib/events";
import { invalidate } from "@/lib/query";
import { keys } from "@/lib/sync";
import { applyEvent, mergeThread, type ChatEvent } from "./threadState";

interface State {
  thread: ChatThread | null;
  status: "idle" | "loading" | "ready" | "error";
  error: unknown;
}

type Action = { type: "reset" } | { type: "loading" } | { type: "loaded"; thread: ChatThread } | { type: "failed"; error: unknown } | { type: "event"; event: ChatEvent };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { thread: null, status: "idle", error: undefined };
    case "loading":
      return { ...state, status: state.thread ? state.status : "loading" };
    case "loaded":
      return { thread: mergeThread(state.thread, action.thread), status: "ready", error: undefined };
    case "failed":
      return { ...state, status: state.thread ? "ready" : "error", error: action.error };
    case "event":
      return state.thread ? { ...state, thread: applyEvent(state.thread, action.event) } : state;
  }
}

/**
 * One conversation, live: fetched once, then kept current by chat.* events,
 * and re-fetched (merged, never duplicated) when the event stream comes back.
 */
export function useThread(siteId: string, threadId: string | null, onMissing: () => void) {
  const [state, dispatch] = useReducer(reducer, { thread: null, status: "idle", error: undefined });

  const load = useCallback(
    async (id: string) => {
      dispatch({ type: "loading" });
      try {
        dispatch({ type: "loaded", thread: await api("GET /api/sites/:siteId/threads/:threadId", { params: { siteId, threadId: id } }) });
      } catch (error) {
        if (isApiFailure(error) && error.shape.code === "not-found") onMissing();
        dispatch({ type: "failed", error });
      }
    },
    [siteId, onMissing],
  );

  useEffect(() => {
    if (!threadId) {
      dispatch({ type: "reset" });
      return;
    }
    if (state.thread?.id !== threadId) dispatch({ type: "reset" });
    void load(threadId);
    // Only a change of conversation reloads; the thread itself updates from events.
  }, [threadId, load]);

  useEffect(() => (threadId ? onReconnect(() => void load(threadId)) : undefined), [threadId, load]);

  const onEvent = (event: ChatEvent) => {
    if (event.siteId !== siteId) return;
    dispatch({ type: "event", event });
    if (event.type === "chat.done") invalidate(keys.threads(siteId));
  };
  useServerEvent("chat.message", onEvent);
  useServerEvent("chat.delta", onEvent);
  useServerEvent("chat.tool", onEvent);
  useServerEvent("chat.done", onEvent);
  useServerEvent("chat.error", onEvent);

  /** Adopt a thread just created here, before its first event arrives. */
  const adopt = useCallback((thread: ChatThread) => dispatch({ type: "loaded", thread }), []);
  const retry = useCallback(() => (threadId ? load(threadId) : Promise.resolve()), [threadId, load]);

  return { ...state, adopt, retry };
}
