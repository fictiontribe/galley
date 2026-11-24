/**
 * The demo's stand-in for mock/preview.ts (swapped in by vite.demo.config.ts).
 *
 * On a developer's machine the mock starts two loopback HTTP servers per
 * site. In the visitor's browser there is no server: both the preview and
 * the live comparison are the built sample site, served as files under the
 * demo's own path (`<base>site/`). The proposed frame applies the working
 * copy's changes to the page in place (demo/frame); the live frame shows the
 * files as they are, which is what was last published.
 */
import type { MockSite } from "../mock/site.ts";

export interface PreviewServers {
  url: string;
  baselineUrl: string;
  close: () => void;
}

/** Where the sample site's files are: `/demo/site` on the marketing site. */
export function snapshotUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}site`;
}

export async function startPreviewServers(_site: MockSite): Promise<PreviewServers> {
  const url = snapshotUrl();
  return { url, baselineUrl: url, close: () => undefined };
}
