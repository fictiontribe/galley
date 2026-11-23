/**
 * Serves the invented WordPress site (fake-site.ts) on this computer, for
 * trying the import by hand from the app or the command line:
 *
 *   node --import tsx test/serve-fake-site.ts --port 4641 [--wxr /tmp/site.xml] [--media-delay 40] [--posts 60 --pages 12 --elementor 4]
 *
 * `--wxr` also writes the same content as an export file. Stops on Ctrl+C.
 */
import { parseArgs } from "node:util";
import { buildFakeSite, serveFakeSite, writeFakeSiteWxr } from "./fake-site";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4641" },
    wxr: { type: "string" },
    "media-delay": { type: "string" },
    posts: { type: "string" },
    pages: { type: "string" },
    elementor: { type: "string" },
    credentials: { type: "string" },
  },
});
const site = buildFakeSite({
  ...(values.posts ? { posts: Number(values.posts) } : {}),
  ...(values.pages ? { pages: Number(values.pages) } : {}),
  ...(values.elementor ? { elementor: Number(values.elementor) } : {}),
});
const running = await serveFakeSite(site, {
  port: Number(values.port),
  ...(values["media-delay"] ? { mediaDelayMs: Number(values["media-delay"]) } : {}),
  ...(values.credentials ? { credentials: values.credentials } : {}),
});

if (values.wxr) writeFakeSiteWxr(site, running.url, values.wxr);
process.stdout.write(`${site.title}: ${site.posts.length} posts, ${site.pages.length} pages, ${site.media.length} images at ${running.url}${values.wxr ? ` (export file: ${values.wxr})` : ""}\n`);
const stop = () => void running.close().then(() => process.exit(0));

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
