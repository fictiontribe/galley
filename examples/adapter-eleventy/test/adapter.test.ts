import { fileURLToPath } from "node:url";

import { describeAdapter } from "@galleycms/adapter-kit/vitest";

import { eleventyAdapter } from "../src/index";

const fixture = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));

describeAdapter(eleventyAdapter, fixture("fixture"), {
  collections: [
    { id: "posts", minEntries: 2, url: "/journal/{slug}/", fields: ["title", "date", "author"] },
    { id: "recipes", minEntries: 2, url: null, fields: ["serves"] },
    { id: "pages", minEntries: 2, url: "/{slug}/" },
    { id: "hours", url: null, fields: ["weekdays"] },
    { id: "staff", url: null },
  ],
  dev: { command: "npm start", port: 8080 },
});

describeAdapter(eleventyAdapter, fixture("fixture-classic"), {
  collections: [
    { id: "notes", minEntries: 2, url: "/notes/{slug}/" },
    { id: "pages", minEntries: 2, url: "/{slug}/" },
    { id: "site", url: null },
  ],
});
