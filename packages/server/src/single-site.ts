/**
 * `openSingleSite`, loaded on first use: the composition module pulls in the
 * whole engine, which startServer also only imports when it needs it.
 */
import type { SingleSiteEngine, SingleSiteOptions } from "./compose";

export async function openSingleSite(options: SingleSiteOptions): Promise<SingleSiteEngine> {
  return (await import("./compose")).openSingleSite(options);
}
