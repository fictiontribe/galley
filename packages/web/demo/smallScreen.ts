/**
 * The app is a desktop tool: below this size its three regions (form,
 * preview, assistant) don't fit, so the demo doesn't load it and offers the
 * film and the tour instead.
 */
export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 600;

export function fitsTheDemo(win: Pick<Window, "innerWidth" | "innerHeight">): boolean {
  return win.innerWidth >= MIN_WIDTH && win.innerHeight >= MIN_HEIGHT;
}

export function renderSmallScreen(root: HTMLElement, win: Window): void {
  document.title = "Galley demo — needs a larger screen";
  root.innerHTML = `
    <main class="demo-small">
      <p class="demo-small__eyebrow">Galley demo</p>
      <h1 class="demo-small__title">The demo needs a larger screen.</h1>
      <p class="demo-small__body">It runs the real app, which is made for a laptop or desktop: a form, the page and the assistant side by side. Open this page on a wider screen, or watch the film and take the tour here.</p>
      <video class="demo-small__film" controls preload="none" playsinline poster="/video/galley-explainer-poster.webp">
        <source src="/video/galley-explainer.webm" type="video/webm" />
        <source src="/video/galley-explainer.mp4" type="video/mp4" />
        <track kind="captions" src="/video/galley-explainer.en.vtt" srclang="en" label="English" default />
      </video>
      <p class="demo-small__links"><a href="/tour/">Take the tour</a> · <a href="/">Back to the site</a></p>
    </main>`;
  // Made wider (a window resized, a tablet turned): offer the real thing.
  const media = win.matchMedia(`(min-width: ${MIN_WIDTH}px) and (min-height: ${MIN_HEIGHT}px)`);
  media.addEventListener("change", (event) => {
    if (event.matches) win.location.reload();
  });
}
