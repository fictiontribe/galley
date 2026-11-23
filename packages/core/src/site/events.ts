/**
 * The in-process event bus. The server fans it out over SSE; the engine emits
 * into it from file writes, the watcher, preview status changes and jobs.
 */
import type { EventBus, ServerEvent } from "../types";

export function createEventBus(): EventBus {
  const listeners = new Set<(event: ServerEvent) => void>();

  return {
    emit(event) {
      // Copy first: a listener that unsubscribes while being called must not
      // make the loop skip the next one.
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // One failing subscriber (a closed SSE stream) must not stop the rest,
          // nor the write that caused the event.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
