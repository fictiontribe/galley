/**
 * Ports: the operator's fixed range for the preview proxies, and free ports
 * for dev servers.
 *
 * Hosted behind a container's fixed port mapping, a proxy on a random port
 * can't be reached at all, so an operator can name a range
 * (GALLEY_PREVIEW_PORTS=4410-4429) that every preview and baseline proxy of
 * the process allocates from, lowest free port first.
 */
import net from "node:net";
import type { Server } from "node:http";
import { GalleyError } from "../../errors";

export interface PortRange {
  from: number;
  to: number;
}

/** "4410-4429" (or "4410–4429", or one port "4410") → { from, to }. Throws a plain GalleyError otherwise. */
export function parsePortRange(text: string, source = "GALLEY_PREVIEW_PORTS"): PortRange {
  const match = /^\s*(\d{1,5})\s*(?:[-–]\s*(\d{1,5}))?\s*$/.exec(text);
  const from = match ? Number(match[1]) : NaN;
  const to = match ? Number(match[2] ?? match[1]) : NaN;

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || from > to) {
    throw new GalleyError("invalid", `${source} must be a range of ports like 4410-4429, not “${text.trim()}”.`);
  }
  return { from, to };
}

export interface PortPool {
  readonly range: PortRange;
  /**
   * Listens on the lowest free port of the range for `owner` (one preview —
   * its preview and baseline proxies share an owner). Throws a plain error
   * when every port is taken.
   */
  listen(server: Server, host: string, owner: object): Promise<number>;
  release(port: number): void;
}

function tryListen(server: Server, port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(true);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function createPortPool(range: PortRange): PortPool {
  const held = new Map<number, object>();
  const size = range.to - range.from + 1;

  return {
    range,
    async listen(server, host, owner) {
      for (let port = range.from; port <= range.to; port += 1) {
        if (held.has(port)) continue;
        // Claimed before the await, so two previews starting at once never try the same port.
        held.set(port, owner);
        if (await tryListen(server, port, host).catch((error) => {
          held.delete(port);
          throw error;
        })) {
          return port;
        }
        held.delete(port);
      }
      const open = new Set(held.values()).size;

      throw new GalleyError(
        "busy",
        `All ${size} preview ports (${range.from}–${range.to}) are in use, and ${open === 1 ? "1 preview is" : `${open} previews are`} open. Stop a preview you aren't using, or give the server more ports with GALLEY_PREVIEW_PORTS.`
      );
    },
    release(port) {
      held.delete(port);
    },
  };
}

/** Whether nothing listens on `port` on either loopback address (an IPv6-less machine counts as free there). */
export async function portIsFree(port: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "::1"]) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();

      probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT"));
      probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
    });

    if (!free) return false;
  }
  return true;
}

/**
 * A port for a dev server: `preferred` when it is free, else the next free
 * one above it (dev servers' own habit, so the numbers stay familiar), else
 * whatever the system hands out.
 */
export async function freePort(preferred: number | null, avoid: ReadonlySet<number> = new Set()): Promise<number> {
  if (preferred) {
    for (let port = preferred; port < Math.min(65536, preferred + 50); port += 1) {
      if (!avoid.has(port) && (await portIsFree(port))) return port;
    }
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();

      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const value = typeof address === "object" && address ? address.port : 0;

        probe.close(() => resolve(value));
      });
    });

    if (port && !avoid.has(port) && (await portIsFree(port))) return port;
  }
  throw new GalleyError("preview", "No free port was found for the preview.");
}
