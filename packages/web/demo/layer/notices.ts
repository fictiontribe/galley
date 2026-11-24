/**
 * Where the demo differs from the product, it says so in a sentence: the
 * band at the top of the window carries one for each screen that would need
 * a real account, a real site or a real service. Screens that work as they
 * do on your own computer (editing, Proof, Publish, history) say nothing.
 */

const NOTICES: Array<[RegExp, string]> = [
  [/^\/$/, "Adding, opening and cloning sites are stand-ins here: whatever you add is another copy of the sample site."],
  [/^\/new$/, "A new site in the demo is a copy of the sample site. On your own computer it starts from the starter you choose."],
  [/^\/settings$/, "The demo has no AI key and keeps no settings. Its assistant replays one recorded answer."],
  [/^(\/sites\/[^/]+)?\/plugins$/, "Plugins here are samples: nothing is installed and nothing runs."],
  [/^\/sites\/[^/]+\/online$/, "Online is a stand-in here: it answers with sample results, and nothing is created or put online."],
  [/^\/sites\/[^/]+\/import$/, "The WordPress move is a stand-in here: it reads no real site, and what it brings across is sample content."],
  [/^\/sites\/[^/]+\/media$/, "Generating images or videos makes labelled placeholders here. On your own site it uses your own image service."],
  [/^\/sites\/[^/]+\/brand$/, "This is the sample site’s brand, as saved. Reading it again needs the site running on your own computer."],
  [/^\/sites\/[^/]+\/redirects$/, "Sending redirects to a host is a stand-in here: nothing changes anywhere."],
  [/^\/sites\/[^/]+\/inbox$/, "These messages are invented. Send the contact form on the sample site’s contact page and yours arrives here too."],
  [/^\/sites\/[^/]+\/visibility$/, "The checks read the sample site’s content. Those that need the built pages show sample results."],
  [/^\/sites\/[^/]+\/settings$/, "Settings change the sample site’s files like any other edit. Nothing here is connected to a real host."],
];

/** The sentence for the app's route (`/sites/caddow/online`), or null. */
export function noticeFor(route: string): string | null {
  const path = route.split(/[?#]/)[0] || "/";
  return NOTICES.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}
