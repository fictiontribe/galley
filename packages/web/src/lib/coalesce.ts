/**
 * Latest-wins request coalescing. A burst of "something changed" events (an
 * import writes 159 files; each write is an event) must not become a burst of
 * identical requests: the answer to the last one is the only one anyone
 * needs. So at most one run is in flight, and calls that arrive meanwhile
 * collapse into a single trailing run that starts when it finishes — that
 * trailing run sees everything the burst did.
 */

export interface Coalesced {
  /** Run now, or once more after the run in flight. Resolves when a run that started after this call has finished. */
  (): Promise<void>;
  /** Whether a run is in flight. */
  readonly busy: boolean;
}

export function coalesce(run: () => Promise<void>): Coalesced {
  let inflight: Promise<void> | null = null;
  let trailing: Promise<void> | null = null;

  const start = (): Promise<void> => {
    const current = run()
      .catch(() => undefined)
      .finally(() => {
        if (inflight === current) inflight = null;
      });
    inflight = current;
    return current;
  };

  const call = (() => {
    // Everyone who asks while a run is in flight shares the one run that follows it.
    if (trailing) return trailing;
    if (!inflight) return start();
    trailing = inflight.then(() => {
      trailing = null;
      return start();
    });
    return trailing;
  }) as Coalesced;

  Object.defineProperty(call, "busy", { get: () => inflight !== null });
  return call;
}

/** One coalesced runner per key (a site id), created on first use. */
export function coalesceBy<K>(run: (key: K) => Promise<void>): (key: K) => Promise<void> {
  const runners = new Map<K, Coalesced>();
  return (key) => {
    let runner = runners.get(key);
    if (!runner) runners.set(key, (runner = coalesce(() => run(key))));
    return runner();
  };
}
