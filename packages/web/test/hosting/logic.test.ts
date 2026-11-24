import { describe, expect, it } from "vitest";
import type { EditorHostAccount, EditorHostInfo, HostedEditorStatus } from "@galley/core/hosting/types";
import type { Job } from "@galley/core/types";
import {
  PLAN_FRESH_MS,
  blockingGaps,
  byHandGaps,
  cardState,
  choiceProblems,
  chosenAccount,
  costHeadline,
  costPhrase,
  creationStages,
  credentialName,
  displayRepository,
  editorAddress,
  emptyDraft,
  healthWords,
  keysReady,
  nextStep,
  offeredKeys,
  planIsStale,
  planRequest,
  previousStep,
  priceDate,
  questionSteps,
  reachLines,
  removalConfirmed,
  removedLine,
  resourceGroups,
  resourceWords,
  sleepsWhileUnused,
  stepLabel,
  suggestedAddresses,
  threeNames,
  toggleKey,
  upgradeLine,
  withDefaultOptions,
} from "../../src/features/hosting/logic";

const COST = { monthly: 13.24, currency: "USD" as const, lines: [], note: "", source: "https://example.com/prices", checked: "2026-11-23" };
const FLY: EditorHostInfo = {
  id: "fly",
  name: "Fly.io",
  summary: "",
  kind: "managed",
  credentials: [
    { secret: "fly", label: "Fly.io access key", help: "", docsUrl: "", permissions: [], required: true },
    { secret: "cloudflare", label: "Cloudflare access key (optional)", help: "", docsUrl: "", permissions: [], required: false },
  ],
  secrets: [
    { name: "fly", configured: false, source: null },
    { name: "cloudflare", configured: false, source: null },
  ],
  cost: COST,
  options: [{ key: "memory", label: "Memory", choices: [{ value: "2048", label: "2 GB" }, { value: "1024", label: "1 GB" }], default: "2048" }],
  docsUrl: "",
};
const OWN: EditorHostInfo = { ...FLY, id: "own-server", kind: "self-run", credentials: [], secrets: [], options: [] };
const ACCOUNT: EditorHostAccount = {
  accounts: [
    { id: "studio", name: "Studio" },
    { id: "personal", name: "Personal" },
  ],
  regions: [
    { id: "iad", name: "Ashburn" },
    { id: "lhr", name: "London" },
  ],
  domains: [{ id: "z1", name: "example.com" }],
  gaps: [
    { what: "Can't make apps.", where: "Tokens", blocking: true },
    { what: "Can't change DNS names.", where: "API Tokens", blocking: false },
  ],
};
const RECORD = { host: "fly", account: "studio", name: "acme-editor", addresses: { editor: "cms.example.com", preview: "cms-preview.example.com", live: "cms-live.example.com" }, image: "x:0.0.9", version: "0.0.9", createdAt: "2026-11-01T00:00:00Z", resources: [{ kind: "app", id: "a1", name: "acme-editor" }], setup: "pending" as const };
const STATUS: HostedEditorStatus = { config: null, record: null, health: "unknown", runningVersion: null, currentVersion: "0.1.0", upgradeAvailable: false, job: null, pending: null, suggestedName: "acme-editor" };

describe("the flow's steps", () => {
  it("asks for keys only where a host has any", () => {
    expect(questionSteps(FLY)).toEqual(["where", "connect", "choices", "handover", "review"]);
    expect(questionSteps(OWN)).toEqual(["where", "choices", "handover", "review"]);
    expect(nextStep("where", OWN)).toBe("choices");
    expect(previousStep("choices", OWN)).toBe("where");
    expect(previousStep("choices", FLY)).toBe("connect");
    expect(nextStep("review", FLY)).toBe("review");
    expect(stepLabel("connect", FLY)).toBe("Step 2 of 5");
    expect(stepLabel("creating", FLY)).toBeNull();
  });

  it("is ready to look at the account once every required key is stored", () => {
    expect(keysReady(FLY)).toBe(false);
    expect(keysReady({ ...FLY, secrets: [{ name: "fly", configured: true, source: "stored", hint: "abcd" }] })).toBe(true);
    expect(keysReady(OWN)).toBe(true);
    expect(blockingGaps(ACCOUNT).map((gap) => gap.what)).toEqual(["Can't make apps."]);
    expect(byHandGaps(ACCOUNT).map((gap) => gap.what)).toEqual(["Can't change DNS names."]);
  });
});

describe("the answers", () => {
  it("never starts with a key ticked", () => {
    expect(emptyDraft("acme-editor")).toMatchObject({ name: "acme-editor", handover: { repository: true, identity: true, liveAddress: true, keys: [] } });
  });

  it("takes each choice's default and the first place, keeping what was chosen", () => {
    expect(withDefaultOptions({}, FLY, ACCOUNT)).toEqual({ memory: "2048", region: "iad" });
    expect(withDefaultOptions({ memory: "1024", region: "lhr" }, FLY, ACCOUNT)).toEqual({ memory: "1024", region: "lhr" });
    expect(withDefaultOptions({ memory: "999" }, FLY, null)).toEqual({ memory: "2048" });
  });

  it("uses the only account there is, and asks when there are more", () => {
    expect(chosenAccount({ account: "" }, { ...ACCOUNT, accounts: [{ id: "solo", name: "Solo" }] })).toBe("solo");
    expect(chosenAccount({ account: "" }, ACCOUNT)).toBe("");
    expect(chosenAccount({ account: "personal" }, ACCOUNT)).toBe("personal");
    const draft = { ...emptyDraft("acme-editor"), host: "fly", address: "cms.example.com" };
    expect(choiceProblems(draft, ACCOUNT).account).toBe("Choose the account the editor goes in.");
    expect(choiceProblems({ ...draft, account: "studio" }, ACCOUNT)).toEqual({});
  });

  it("shows the three names as they're derived, and says what's wrong with an address", () => {
    const draft = { ...emptyDraft("acme-editor"), address: "CMS.Example.com" };
    expect(threeNames(draft)).toEqual({ editor: "cms.example.com", preview: "cms-preview.example.com", live: "cms-live.example.com" });
    expect(threeNames({ ...draft, previewAddress: "look.example.com" })?.preview).toBe("look.example.com");
    expect(threeNames({ ...draft, address: "https://cms.example.com" })).toBeNull();
    expect(choiceProblems({ ...draft, address: "https://cms.example.com" }, null).address).toContain("without “https://”");
    expect(choiceProblems({ ...draft, name: "Acme Editor" }, null).name).toBeDefined();
    expect(choiceProblems({ ...draft, previewAddress: "cms.example.com" }, null).preview).toContain("each need a name of their own");
    expect(suggestedAddresses(ACCOUNT)).toEqual(["cms.example.com"]);
  });

  it("sends exactly the answers: keys only as ticked, names only when changed", () => {
    let draft = { ...emptyDraft("acme-editor"), host: "fly", address: " cms.example.com ", options: { memory: "2048", region: "lhr" } };
    draft = { ...draft, handover: { ...draft.handover, keys: toggleKey(toggleKey(draft.handover.keys, "anthropic", true), "openai", true) } };
    draft = { ...draft, handover: { ...draft.handover, keys: toggleKey(draft.handover.keys, "openai", false) } };
    expect(planRequest(draft, { ...ACCOUNT, accounts: [{ id: "studio", name: "Studio" }] })).toEqual({
      host: "fly",
      account: "studio",
      name: "acme-editor",
      address: "cms.example.com",
      options: { memory: "2048", region: "lhr" },
      handover: { repository: true, identity: true, liveAddress: true, keys: ["anthropic"] },
    });
    expect(planRequest({ ...draft, liveAddress: "Compare.example.com" }, null)).toMatchObject({ liveAddress: "compare.example.com" });
    expect(planRequest({ ...draft, liveAddress: "Compare.example.com" }, null)).not.toHaveProperty("previewAddress");
  });

  it("asks for the plan again when it's nearly fifteen minutes old", () => {
    expect(planIsStale(0, PLAN_FRESH_MS)).toBe(false);
    expect(planIsStale(0, PLAN_FRESH_MS + 1)).toBe(true);
    expect(PLAN_FRESH_MS).toBeLessThan(15 * 60_000);
  });

  it("offers the stored keys an editor could use, the assistant's first, never the host's own", () => {
    const offered = offeredKeys([
      { name: "openai", configured: true, source: "stored", hint: "x2Lk" },
      { name: "fly", configured: true, source: "stored", hint: "fly1" },
      { name: "google", configured: false, source: null },
      { name: "anthropic", configured: true, source: "env", hint: "9f3a" },
    ]);
    expect(offered.map((key) => [key.name, key.hint])).toEqual([
      ["anthropic", "9f3a"],
      ["openai", "x2Lk"],
    ]);
  });

  it("shows a repository address without what would let someone in", () => {
    expect(displayRepository("https://sam:not-a-secret@github.com/example/site.git")).toBe("https://github.com/example/site.git");
    expect(displayRepository("git@github.com:example/site.git")).toBe("git@github.com:example/site.git");
    expect(displayRepository(undefined)).toBeNull();
  });
});

describe("words", () => {
  it("says money roughly, never as a quote", () => {
    expect(costPhrase(COST)).toBe("about $13 a month");
    expect(costPhrase({ monthly: 4.5, currency: "USD" })).toBe("about $4.50 a month");
    expect(costPhrase({ monthly: 9.99, currency: "EUR" })).toBe("about €9.99 a month");
    expect(costPhrase({ monthly: 0, currency: "USD" })).toBe("no monthly cost");
    expect(priceDate("2026-11-23", "en-GB")).toBe("23 Nov 2026");
  });

  it("says health in plain words", () => {
    expect(healthWords("healthy")).toEqual({ text: "Running", tone: "success" });
    expect(healthWords("setup").text).toBe("Waiting for first run");
    expect(healthWords("starting").text).toBe("Starting");
    expect(healthWords("unreachable").text).toBe("Can’t be reached");
    expect(healthWords("unknown").text).toBe("Not known");
  });

  it("names the stages of a create", () => {
    const job = (progress: number, state: Job["state"] = "running"): Job => ({ id: "j", kind: "editor-host", label: "Putting the editor online", state, progress, startedAt: 0 });
    expect(creationStages(job(0.3), true).map((stage) => stage.state)).toEqual(["current", "todo", "todo"]);
    expect(creationStages(job(0.7), true).map((stage) => stage.state)).toEqual(["done", "current", "todo"]);
    expect(creationStages(job(1, "done"), true).every((stage) => stage.state === "done")).toBe(true);
    expect(creationStages(job(0.7), false).map((stage) => stage.state)).toEqual(["done", "current"]);
  });
});

describe("the card", () => {
  it("knows whether there is an editor, and where", () => {
    expect(cardState(STATUS)).toBe("none");
    expect(cardState({ ...STATUS, config: { url: "https://cms.example.com/" } })).toBe("online");
    expect(editorAddress({ ...STATUS, config: { url: "https://cms.example.com/" } })).toBe("cms.example.com");
    expect(cardState({ ...STATUS, record: RECORD, pending: { steps: [], files: [] } })).toBe("online");
    // A create that stopped half-way: only removing is left.
    expect(cardState({ ...STATUS, record: RECORD })).toBe("unfinished");
    expect(editorAddress({ ...STATUS, record: RECORD })).toBe("cms.example.com");
    expect(upgradeLine({ ...STATUS, record: RECORD, runningVersion: null })).toBe("Version 0.0.9 → 0.1.0");
  });

  it("removes only when the address is typed as shown", () => {
    expect(removalConfirmed("cms.example.com", "cms.example.com")).toBe(true);
    expect(removalConfirmed(" https://CMS.example.com/ ", "cms.example.com")).toBe(true);
    expect(removalConfirmed("cms.example", "cms.example.com")).toBe(false);
    expect(removalConfirmed("", "")).toBe(false);
  });
});

describe("what is created and removed, in plain words", () => {
  const fly = { id: "fly", name: "Fly.io" };
  const known = { accounts: [{ id: "personal", name: "Sam's organization" }], regions: [{ id: "iad", name: "Ashburn, Virginia (US)" }] };
  const record = [
    { kind: "app", id: "a1", name: "site-editor", detail: "In the organization personal" },
    { kind: "ip", id: "66.241.124.10", name: "shared IPv4" },
    { kind: "volume", id: "vol_1", name: "site_editor_data", detail: "3 GB in iad" },
    { kind: "machine", id: "m1", name: "site-editor", detail: "2 GB in iad" },
    { kind: "certificate", id: "cms.example.com", name: "cms.example.com" },
    { kind: "dns-record", id: "zone/rec", name: "cms.example.com", detail: "cms.example.com → site-editor.fly.dev, on example.com" },
  ];

  it("groups by where each thing lives: a built-in host's DNS names are on Cloudflare", () => {
    const groups = resourceGroups(record, fly);
    expect(groups.map((group) => [group.place, group.resources.length, group.start])).toEqual([
      ["Fly.io", 5, 1],
      ["Cloudflare", 1, 6],
    ]);
    expect(resourceGroups(record, { id: "cloudflare", name: "Cloudflare" }).map((group) => group.place)).toEqual(["Cloudflare"]);
    // A plugin host's DNS name: nothing says where it lives.
    expect(resourceGroups(record, { id: "acme-host", name: "Acme" }).map((group) => group.place)).toEqual(["Acme", null]);
  });

  it("says what each thing is, shows a place and an account by name, and never says a name twice", () => {
    expect(resourceWords(record[0]!, known)).toEqual({ what: "The app", name: "site-editor", detail: "In the organization “Sam's organization”" });
    expect(resourceWords(record[1]!, known)).toEqual({ what: "An address", name: "shared IPv4", detail: null });
    expect(resourceWords(record[2]!, known)).toEqual({ what: "The disk", name: "site_editor_data", detail: "3 GB in Ashburn, Virginia (US)" });
    expect(resourceWords(record[3]!, known).what).toBe("The computer");
    expect(resourceWords(record[4]!).what).toBe("A certificate");
    expect(resourceWords(record[5]!)).toEqual({ what: "A name at your domain’s provider", name: null, detail: "cms.example.com → site-editor.fly.dev, on example.com" });
    // Without the names, the codes stay: still true.
    expect(resourceWords(record[2]!).detail).toBe("3 GB in iad");
    // A plan's row already names it in its detail.
    expect(resourceWords({ kind: "certificate", id: "", name: "cms.example.com", detail: "HTTPS certificate for cms.example.com" }).name).toBeNull();
    expect(resourceWords({ kind: "app", id: "", name: "site-editor", detail: "The editor's app, also reachable at site-editor.fly.dev" }).name).toBe("site-editor");
    expect(resourceWords({ kind: "widget", id: "", name: "w1", detail: "A widget" })).toEqual({ what: null, name: "w1", detail: "A widget" });
  });

  it("says what a finished removal took, by place", () => {
    expect(removedLine({ resources: record }, fly)).toBe("Deleted 5 things from Fly.io and 1 from Cloudflare.");
    expect(removedLine({ resources: record.slice(0, 1) }, fly)).toBe("Deleted 1 thing from Fly.io.");
    expect(removedLine({ resources: [] }, fly)).toContain("Nothing was on an account");
  });
});

describe("the connect step's words", () => {
  it("says optional once", () => {
    expect(credentialName("Cloudflare access key (optional)")).toBe("Cloudflare access key");
    expect(credentialName("Fly.io access key")).toBe("Fly.io access key");
  });

  it("names the accounts and the domains a key can reach", () => {
    expect(reachLines({ name: "Fly.io" }, { accounts: [{ id: "personal", name: "Sam's organization" }], domains: [{ id: "z1", name: "example.com" }, { id: "z2", name: "example.org" }] })).toEqual([
      "On Fly.io it can create the editor in “Sam's organization”.",
      "On Cloudflare it can add the editor’s names to example.com and example.org.",
    ]);
    expect(reachLines({ name: "Cloudflare" }, { accounts: [{ id: "a", name: "Studio account" }, { id: "b", name: "Other" }], domains: [] })).toEqual(["On Cloudflare it can create the editor in “Studio account” or “Other”."]);
    expect(reachLines({ name: "Fly.io" }, { accounts: [], domains: [] })).toEqual([]);
  });
});

describe("the plan's headline cost", () => {
  it("is the month for a computer that stays awake, and a range when it sleeps while unused", () => {
    expect(costHeadline(COST)).toBe("About $13 a month");
    expect(costHeadline(COST, { sleeps: true })).toBe("Up to about $13 a month — it sleeps while nobody is using it, so it usually costs much less");
    expect(costHeadline(COST, { sleeps: true, low: 2.27 })).toBe("About $2 to $13 a month — it sleeps while nobody is using it");
    expect(costHeadline({ monthly: 0, currency: "USD" }, { sleeps: true })).toBe("No monthly cost");
  });

  it("knows the choice from the host's sleep option, on unless turned off", () => {
    const host = { options: [{ key: "sleep", label: "Sleep", choices: [{ value: "on", label: "On" }, { value: "off", label: "Off" }], default: "on" }] };
    expect(sleepsWhileUnused(host, {})).toBe(true);
    expect(sleepsWhileUnused(host, { sleep: "off" })).toBe(false);
    expect(sleepsWhileUnused({ options: [] }, {})).toBe(false);
  });
});

describe("the Online screen's rhythm", () => {
  it("keeps the space above the headings under the editor card, whichever stylesheet loads last", async () => {
    const { readFileSync } = await import("node:fs");
    const { URL: NodeURL } = await import("node:url");
    const css = (path: string) => readFileSync(new NodeURL(path, import.meta.url), "utf8");
    // `.app-section__title` sets margin: 0; two classes outrank it in any order.
    expect(css("../../src/features/deploy/deploy.css")).toMatch(/\.app-section__title\.deploy-list__title \{ margin-block: var\(--space-8\) var\(--space-3\); \}/);
    expect(css("../../src/features/hosting/hosting.css")).toMatch(/\.app-section__title\.host-section-title \{ margin-block: var\(--space-8\) var\(--space-3\); \}/);
  });
});
