/** The in-browser demo (src/data/site.json → demo): nothing links to it while `available` is false. */
import { site } from "./site";

const d = (site as unknown as { demo?: { available?: boolean; href?: string } }).demo ?? {};
export const demo = { on: d.available === true && Boolean(d.href), href: d.href ?? "/demo/" };
