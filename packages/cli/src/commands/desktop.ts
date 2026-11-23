import { PRODUCT } from "@galley/core/brand";
import { StartupError } from "@galley/server";
import { parse, portOption } from "../args";
import type { Io } from "../io";

export const DESKTOP_HELP = `Usage: ${PRODUCT.slug} desktop [options]

Run the server for the desktop app, which starts it with this command. It
opens no site and no browser: the app shows the sites list in its own window.
Listens on 127.0.0.1 only, on exactly the port given (no fallback), so the app
knows where to find it.

Options
  -p, --port <port>      Port to listen on (default GALLEY_PORT, then 4400)
      --exit-with-parent Stop when standard input closes, i.e. when the
                         process that started this one exits or crashes
  -h, --help             Show this help

Environment
  GALLEY_TOKEN           The session token the app signs in with
  GALLEY_DESKTOP=1       Set by the app (reported by /api/meta)`;

const never = new Promise<void>(() => {});

export async function desktopCommand(argv: string[], io: Io): Promise<number> {
  const { values } = parse("desktop", argv, { port: { type: "string", short: "p" }, "exit-with-parent": { type: "boolean" } }, 0);

  if (values.help) {
    io.out(DESKTOP_HELP);
    return 0;
  }
  // Start watching before the (slow) start-up, so a parent that dies meanwhile is still noticed.
  const parent = values["exit-with-parent"] ? io.watchParent() : null;
  let server;

  try {
    server = await io.startServer({
      mode: "local",
      host: io.env.GALLEY_HOST?.trim() || "127.0.0.1",
      port: portOption(values.port),
      findFreePort: false,
      desktop: true,
      env: io.env,
      notice: (line) => io.err(line),
    });
  } catch (error) {
    parent?.stop();
    if (error instanceof StartupError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
  io.out(`${PRODUCT.name} is running at ${server.url}`);
  const reason = await Promise.race([io.waitForStop().then(() => "stop" as const), parent ? parent.gone.then(() => "parent" as const) : never]);

  parent?.stop();
  io.out(reason === "parent" ? "The app that started this server has exited. Stopping…" : "Stopping…");
  await server.close();
  return 0;
}
