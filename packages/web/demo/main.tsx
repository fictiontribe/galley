/**
 * The demo's entry: the real app, with its server running in this page.
 *
 * Order matters. On a small screen nothing of the app loads at all (it is a
 * desktop tool): a short page offers the film and the tour instead. Otherwise
 * the Node globals the mock needs go in first, then the mock server, then the
 * shims that answer the app's requests from it — and only then the app.
 */
import "@/styles/index.css";
import "./demo.css";
import { fitsTheDemo, renderSmallScreen } from "./smallScreen";

async function start(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("demo/index.html is missing #root");
  if (!fitsTheDemo(window)) {
    renderSmallScreen(root, window);
    return;
  }
  await import("./shim/globals");
  const { boot } = await import("./boot");
  await boot(root);
}

void start();
