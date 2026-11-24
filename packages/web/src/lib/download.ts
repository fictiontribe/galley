/**
 * Saving a file the server makes (an export), the way the Inbox's Export link
 * does: a link with `download`, clicked. Setting `location` to the address
 * instead unloads the app first when the answer isn't a download (an error
 * page), and in the demo it would leave the page; a clicked link does
 * neither, and the demo answers links to /api in the page.
 */
export function download(href: string, name = ""): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.rel = "noopener";
  link.hidden = true;
  // In the document, so the click is a click anywhere a listener is waiting for one (the demo's).
  document.body.append(link);
  link.click();
  link.remove();
}
