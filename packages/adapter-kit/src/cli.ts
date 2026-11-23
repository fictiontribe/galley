/**
 * galley-adapter-check <adapter-file> <fixture-dir>
 *
 * The conformance check for authors who do not use vitest: loads the
 * adapter module, checks it against the fixture, prints a plain report and
 * exits 0 when every check passed (warnings allowed), 1 when one failed and
 * 2 when it could not run at all.
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { adapterFromModule } from "@galley/core/adapter";
import { checkAdapter, formatReport } from "./check";

const USAGE = "Usage: galley-adapter-check <adapter-file> <fixture-dir>\n\nChecks a Galley adapter against a small site of its own framework.\n";

export async function main(argv: string[], out: (text: string) => void = (text) => process.stdout.write(text), err: (text: string) => void = (text) => process.stderr.write(text)): Promise<number> {
  const args = argv.filter((arg) => arg !== "--");

  if (args.includes("--help") || args.includes("-h")) {
    out(USAGE);
    return 0;
  }
  if (args.length !== 2) {
    err(USAGE);
    return 2;
  }
  const [adapterArg, fixtureArg] = args as [string, string];
  const adapterFile = resolve(adapterArg);
  const fixture = resolve(fixtureArg);

  if (!existsSync(adapterFile)) {
    err(`The adapter file ${adapterArg} was not found.\n`);
    return 2;
  }
  if (!existsSync(fixture) || !statSync(fixture).isDirectory()) {
    err(`The fixture folder ${fixtureArg} was not found.\n`);
    return 2;
  }
  let adapter: unknown;

  try {
    adapter = adapterFromModule(await import(pathToFileURL(adapterFile).href));
  } catch (error) {
    err(`${adapterArg} could not be loaded: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const report = await checkAdapter(adapter as never, fixture);
  const label = adapter && typeof adapter === "object" && typeof (adapter as { name?: unknown }).name === "string" ? (adapter as { name: string }).name : adapterArg;

  out(`${formatReport(report, `${label} adapter — ${fixtureArg}`)}\n`);
  return report.ok ? 0 : 1;
}
