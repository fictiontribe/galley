/**
 * Install commands, from one place: src/data/site.json → install.
 *
 * While `install.published` is false (before the first npm release) the site
 * may only show commands that work today: the from-a-clone steps, and for a
 * starter Astro's own installer pointed at the starter's folder in the public
 * repository. Asking for a command the flag says isn't available stops the
 * build, so a page can never show a dead command.
 */
import site from "../data/site.json";
import { fill } from "./site";

const install = site.install;
const repoSlug = new URL(site.repository).pathname.replace(/^\/|\.git$/g, "");

export const published: boolean = install.published;

function notYet(command: string): never {
  throw new Error(`"${command}" isn't available yet: site.json → install.published is false. Show the command that works today instead.`);
}

/** Galley's own one command once published; until then the from-a-clone steps. */
export function runCommands(): string[] {
  return published ? [install.run] : install.fromClone.map(fill);
}

/** The first thing to type, for places with room for one line. */
export function firstCommand(): string {
  return runCommands()[0];
}

/** A starter's one command: create-galley once published, else Astro's installer on the starter's folder. */
export function starterCommand(starter: { short: string; dir: string }, folder = install.folder): { command: string; note: string } {
  const command = published
    ? install.createStarter.replace("{folder}", folder).replace("{starter}", starter.short)
    : install.starterToday.replace("{folder}", folder).replace("{repoSlug}", repoSlug).replace("{dir}", starter.dir);
  assertAvailable(command);
  return { command, note: published ? site.ui.starterPublished : site.ui.starterToday };
}

/** The self-check: before release, nothing on the site may start with a command that isn't published. */
export function assertAvailable(command: string): string {
  if (!published) for (const unpublished of [install.create, install.run]) if (command.trim().startsWith(unpublished)) notYet(command);
  return command;
}

export const output = { label: site.ui.output, running: install.running };
