// Lets made-up names reach the stand-in bucket (serve-media.mts), in the process this is loaded into
// and nowhere else: the capture's own Galley, started with
//
//   NODE_OPTIONS=--import=<this file> CAPTURE_NAMES=<name>=<port><path>,<name>=<port>
//
// so the pictures can show a bucket as a person would have it (https://media.example.com) while every
// request stays on this computer. A request Galley makes to https://<name>/… goes to
// http://127.0.0.1:<port><path>/… with its Host header as Galley wrote it, so a signature still checks.
// Galley itself is unchanged; without CAPTURE_NAMES this does nothing.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

const names = new Map(
  (process.env.CAPTURE_NAMES ?? "").split(",").filter(Boolean).map((pair) => {
    const [name, to = ""] = pair.split("=");
    const at = to.indexOf("/");
    return [name, { port: Number(at === -1 ? to : to.slice(0, at)), path: at === -1 ? "" : to.slice(at) }];
  })
);

if (names.size) {
  const lookup = dns.promises.lookup;
  dns.promises.lookup = (hostname, options) => {
    if (!names.has(hostname)) return lookup(hostname, options);
    const here = { address: "127.0.0.1", family: 4 };
    return Promise.resolve(options?.all ? [here] : here);
  };
  const request = https.request;
  https.request = (url, options, callback) => {
    const to = url instanceof URL ? names.get(url.hostname) : undefined;
    if (!to) return request(url, options, callback);
    const { lookup: _pinned, ...rest } = options ?? {};
    return http.request({ ...rest, host: "127.0.0.1", port: to.port, path: `${to.path}${url.pathname}${url.search}`, headers: { ...rest.headers, host: url.host } }, callback);
  };
  syncBuiltinESMExports();
}
