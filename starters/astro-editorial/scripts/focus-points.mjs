#!/usr/bin/env node
// Writes src/lib/focus.json: each photograph's focus point from the shot list
// (galley/photography/shots.json), by its path under public/images.
//
// The site reads that file, not the shot list. The shot list is a record kept
// beside the site: nothing the site is built from reads it, so when the
// pictures move to a bucket (Media › Storage settings in Galley) no copy has
// to stay in the repository for its sake. Run this after changing a `focus`
// in the shot list, or adding a photograph to it:
//
//   node scripts/focus-points.mjs            write the file
//   node scripts/focus-points.mjs --check    say whether it is up to date, and change nothing

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "galley/photography/shots.json");
const OUT = join(ROOT, "src/lib/focus.json");
const MEDIA = "public/images/";

const { values } = parseArgs({ options: { check: { type: "boolean" } } });
const { shots } = JSON.parse(readFileSync(SHOTS, "utf8"));
const points = {};

for (const shot of [...shots].sort((a, b) => a.file.localeCompare(b.file, "en"))) {
  if (!shot.file.startsWith(MEDIA)) throw new Error(`${shot.id}: ${shot.file} isn't under ${MEDIA}`);
  if (!shot.focus) continue;
  points[shot.file.slice(MEDIA.length)] = `${Math.round(shot.focus.x * 100)}% ${Math.round(shot.focus.y * 100)}%`;
}

const text = `${JSON.stringify(
  {
    $comment: "Each photograph's focus point (across, down), by its path under public/images. Written from galley/photography/shots.json by `npm run focus`: change the shot list, then run that. The site reads this file and not the shot list.",
    points,
  },
  null,
  2
)}\n`;
let current = "";

try {
  current = readFileSync(OUT, "utf8");
} catch {
  // Not written yet.
}
if (values.check) {
  if (current !== text) {
    console.error("src/lib/focus.json is out of date with galley/photography/shots.json. Run: npm run focus");
    process.exit(1);
  }
  console.log(`src/lib/focus.json is up to date (${Object.keys(points).length} photographs).`);
} else if (current === text) {
  console.log(`src/lib/focus.json is already up to date (${Object.keys(points).length} photographs).`);
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote src/lib/focus.json (${Object.keys(points).length} photographs).`);
}
