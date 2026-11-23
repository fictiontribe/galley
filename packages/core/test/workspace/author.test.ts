/**
 * Who a published version is recorded as: this site's own author → the
 * repository's own git settings → App settings › You → the computer's global
 * git identity → a neutral default. The pure order, then the same order
 * through a real repository and a real (temporary) global git config.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chooseAuthor, createWorkspace, type AuthorLayers, type Workspace } from "../../src/workspace/index";
import { cleanupAll, makeRepo, PUBLISH, sh, tempDir, WRITABLE } from "./helpers";

const SITE = { name: "Site Author", email: "site@example.com" };
const REPO = { name: "Repo Author", email: "repo@example.com" };
const APP = { name: "App Author", email: "app@example.com" };
const MACHINE = { name: "Machine Author", email: "machine@example.com" };

describe("the order, on its own", () => {
  it("takes the most specific author that is complete", () => {
    expect(chooseAuthor({ site: SITE, repository: REPO, app: APP, machine: MACHINE })).toEqual({ ...SITE, from: "site" });
    expect(chooseAuthor({ repository: REPO, app: APP, machine: MACHINE })).toEqual({ ...REPO, from: "repository" });
    expect(chooseAuthor({ repository: { name: "Half", email: "" }, app: APP, machine: MACHINE })).toEqual({ ...APP, from: "app" });
    expect(chooseAuthor({ machine: MACHINE })).toEqual({ ...MACHINE, from: "machine" });
    expect(chooseAuthor({})).toEqual({ name: "Site editor", email: "site-editor@localhost", from: "default" });
  });
});

describe("through a real repository", () => {
  const before = process.env.GIT_CONFIG_GLOBAL;
  const open: Workspace[] = [];
  let global: string;

  beforeAll(() => {
    // A global git config of its own, so the computer running the tests can't decide the outcome.
    global = join(tempDir("ws-global-"), "gitconfig");
    writeFileSync(global, `[user]\n\tname = ${MACHINE.name}\n\temail = ${MACHINE.email}\n`);
    process.env.GIT_CONFIG_GLOBAL = global;
  });
  afterEach(() => {
    for (const ws of open.splice(0)) void ws.dispose();
  });
  afterAll(() => {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
    cleanupAll();
  });

  async function author(layers: AuthorLayers, repoAuthor: boolean) {
    const root = makeRepo({ "src/content/a.md": "a\n" });

    if (repoAuthor) {
      sh(root, "config", "--local", "user.name", REPO.name);
      sh(root, "config", "--local", "user.email", REPO.email);
    }
    const ws = await createWorkspace(root, { writable: () => WRITABLE, authorLayers: () => layers, watch: false });

    open.push(ws);
    return { root, ws, status: (await ws.gitStatus()).author };
  }

  it("records the repository's own git identity over App settings › You", async () => {
    const { root, ws, status } = await author({ site: null, app: APP }, true);

    expect(status).toEqual({ ...REPO, from: "repository" });
    writeFileSync(join(root, "src/content/a.md"), "b\n");
    await ws.publish({ message: "Edit" }, PUBLISH);
    expect(sh(root, "log", "-1", "--format=%an <%ae>")).toBe(`${REPO.name} <${REPO.email}>`);
  });

  it("puts this site's own author first, App settings › You next, and the computer's identity last", async () => {
    expect((await author({ site: SITE, app: APP }, true)).status).toEqual({ ...SITE, from: "site" });
    expect((await author({ site: null, app: APP }, false)).status).toEqual({ ...APP, from: "app" });
    expect((await author({ site: null, app: null }, false)).status).toEqual({ ...MACHINE, from: "machine" });
  });
});
