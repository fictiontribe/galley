// The site's colours are written once, as light-dark(light, dark), in
// src/styles/tokens.css. Engines from before light-dark() cannot read those,
// so the same file ends with the light values alone, inside
// `@supports not (color: light-dark(#000, #fff))`. This script writes that
// block from the tokens (--write) or fails when it has fallen behind them.
//
//   node scripts/check-tokens.mjs           check (part of `pnpm build`)
//   node scripts/check-tokens.mjs --write   rewrite the block
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
const START = "/* fallback:start */";
const END = "/* fallback:end */";
const css = readFileSync(file, "utf8");
const from = css.indexOf(START);
const to = css.indexOf(END);
if (from < 0 || to < from) {
  console.error(`check-tokens: ${file} has no "${START}" … "${END}" block.`);
  process.exit(1);
}

// The first argument of every light-dark(), brackets inside it respected.
function lightOf(value) {
  let out = "";
  for (let i = 0; i < value.length; ) {
    if (!value.startsWith("light-dark(", i)) { out += value[i++]; continue; }
    let depth = 0, j = i + "light-dark(".length, comma = -1;
    for (; j < value.length; j++) {
      const c = value[j];
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0 && comma < 0) comma = j;
    }
    if (comma < 0 || j >= value.length) throw new Error(`cannot read "${value.slice(i, i + 60)}…"`);
    out += value.slice(i + "light-dark(".length, comma).trim();
    i = j + 1;
  }
  return out;
}

// Every custom property of the first :root block whose value uses light-dark().
const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));
const lines = [];
for (const m of root.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  if (m[2].includes("light-dark(")) lines.push(`    ${m[1]}: ${lightOf(m[2].trim())};`);
}
if (lines.length === 0) {
  console.error("check-tokens: found no light-dark() tokens in :root.");
  process.exit(1);
}
const block = `${START}
@supports not (color: light-dark(#000, #fff)) {
  :root {
    color-scheme: light;
${lines.join("\n")}
  }
}
${END}`;

const current = css.slice(from, to + END.length);
if (current === block) {
  console.log(`check-tokens: the light values for older engines match the tokens (${lines.length}).`);
} else if (process.argv.includes("--write")) {
  writeFileSync(file, css.slice(0, from) + block + css.slice(to + END.length));
  console.log(`check-tokens: wrote the light values for older engines (${lines.length}).`);
} else {
  console.error("check-tokens: the light values for older engines in src/styles/tokens.css have fallen behind the tokens. Run: node scripts/check-tokens.mjs --write");
  process.exit(1);
}
