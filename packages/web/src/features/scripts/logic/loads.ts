/**
 * "What loads where": for one page address, the scripts the site would load
 * there, in order, and what each waits for — computed from the setup file
 * with the same page rules the runtime uses.
 */
import type { ConsentCategory, ConsentSettings, ScriptEntry, ScriptsConfig } from "@galley/core/kit";
import { consentOf, loadOf, scriptName } from "./entries";
import { pageVerdict } from "./match";

export interface PageLoad {
  index: number;
  id: string;
  name: string;
  load: NonNullable<ScriptEntry["load"]>;
  consent: ConsentCategory;
  /** What has to happen before it loads, in words. */
  waitsFor: string | null;
}

export interface Skipped {
  index: number;
  name: string;
  reason: string;
}

/** Whether a category needs the visitor's agreement first under these consent settings. */
export function needsAgreement(category: ConsentCategory, consent: ConsentSettings | undefined): boolean {
  if (category === "necessary") return false;
  const mode = consent?.mode ?? "none";
  if (mode === "none") return false;
  return !(consent?.defaults ?? []).includes(category);
}

function waitsFor(entry: ScriptEntry, consent: ConsentSettings | undefined): string | null {
  const category = consentOf(entry);
  if (!needsAgreement(category, consent)) return null;
  const who = consent?.mode === "external" ? "your consent tool" : "the visitor";
  return `Waits until ${who} allows ${category}`;
}

/** The scripts that load on `address` (live site, not preview), in file order, and the ones that don't with why. */
export function loadsAt(config: ScriptsConfig, address: string, options: { preview?: boolean } = {}): { loads: PageLoad[]; skipped: Skipped[] } {
  const loads: PageLoad[] = [];
  const skipped: Skipped[] = [];
  config.scripts.forEach((entry, index) => {
    const name = scriptName(entry);
    if (!entry.enabled) return void skipped.push({ index, name, reason: "Switched off" });
    if (options.preview && !entry.inPreview) return void skipped.push({ index, name, reason: "Not loaded in preview" });
    const verdict = pageVerdict(entry, address);
    if (!verdict.loads) {
      const reason = verdict.because ? `Not on pages matching ${verdict.because.pattern}` : `Only on ${(entry.include ?? []).join(", ")}`;
      return void skipped.push({ index, name, reason });
    }
    loads.push({ index, id: entry.id, name, load: loadOf(entry), consent: consentOf(entry), waitsFor: waitsFor(entry, config.consent) });
  });
  return { loads, skipped };
}
