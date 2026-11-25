/**
 * Every request a test makes says "connection: close", so none of them rides
 * a connection kept from the request before.
 *
 * Why. A test here starts the server in its own process and asks it things
 * with `fetch`, so the server and the test share one event loop. Node's
 * server closes a connection that has been idle for five seconds, and
 * `fetch` keeps connections to use again. Between two requests many tests
 * run git with `execFileSync`, which holds the loop until git has finished.
 * On a machine where that takes more than five seconds, the server's timer
 * fires as soon as the loop is free, the next request goes out on the
 * connection being closed, and `fetch` fails with "fetch failed", cause
 * "read ECONNRESET": no status, the server alive and answering the test
 * after it. That is how `visibility.test.ts` failed once in CI, on the first
 * request after a test that took ten seconds there and a third of one here.
 *
 * It can be seen without the app: a plain `http.createServer`, one `fetch`,
 * the loop held for six seconds with `Atomics.wait`, a second `fetch`. As it
 * is, that second request failed in two rounds of four; with
 * "connection: close" on both, in none, each request opening a connection of
 * its own.
 *
 * A header the test set itself is left as it is.
 */
const plainFetch = globalThis.fetch;

globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

  if (!headers.has("connection")) headers.set("connection", "close");
  return plainFetch(input, { ...init, headers });
}) as typeof fetch;
