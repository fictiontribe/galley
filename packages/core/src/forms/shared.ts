/**
 * Form rules the browser and the server share, in one dependency-free
 * module: no Node built-ins, no packages, types only — so the web app can
 * import it (`@galley/core/forms/shared`) without pulling the capture
 * server's Node modules into its bundle, and the engine, the builder and
 * the capture endpoint can never disagree.
 *
 * - the free mailboxes "business email only" refuses (the site kit's
 *   `forms/free-email-domains.js` is the source; a test keeps them equal);
 * - the pattern guard: which `validation.pattern`s are safe to run on a
 *   server, and running one with a bound on the input;
 * - which search hits are pages that show a given form, and which forms an
 *   entry's fields name;
 * - the "Contact" form the app starts a site with.
 */
import type { FormDefinition } from "../kit";
import type { Field, JsonValue, SearchHit } from "../types";

/**
 * Free mailbox providers refused by "business email only": the same list the
 * site's script checks in the browser (`@galley/astro`, forms/free-email-domains.js),
 * so the server never refuses an address the page accepted. A site can add
 * domains for its own pages (`forms.freeEmailDomains`); those are checked in
 * the browser only.
 */
export const FREE_MAILBOXES: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.jp",
  "yahoo.fr",
  "ymail.com",
  "rocketmail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "hanmail.net",
  "libero.it",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "t-online.de",
  "btinternet.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "tuta.io",
  "rediffmail.com",
  "uol.com.br",
  "bol.com.br",
];

/** Whether an address is at one of the free mailboxes. */
export function isFreeMailbox(address: string): boolean {
  const domain = address.split("@").pop()?.trim().toLowerCase() ?? "";

  return FREE_MAILBOXES.includes(domain);
}

// ───────────────────────────────────────────────────────── the pattern guard
//
// A form file's `validation.pattern` is a regular expression written by
// whoever edits the form, and the capture endpoint runs it on text anyone
// can post. JavaScript's regex engine backtracks, so a pattern like
// `(a+)+$` can take minutes on forty characters — one request would stall
// the server. Node has no time limit for a regex and we take no native
// dependency, so the guard is static and conservative:
//
//   1. Nested repetition. A repeated part (`*`, `+`, `{n,}`, or a count
//      over 1) that itself holds a repeated part — `(a+)+`, `(\w*\s?)*`,
//      `(?:\d{1,3})+`. Allowed only when every pass of the outer repetition
//      must end (or start) with a character the rest of that pass can't
//      contain, so a match can be split one way only: `([a-z0-9-]+\.)+`.
//   2. Overlapping choices under a repetition. A repeated part with
//      alternatives that can start with the same character, or that can
//      match nothing: `(a|ab)+`, `(\w|\d)*`, `(x|)+`.
//   3. Three or more unbounded repetitions in a row that can all take the
//      same character, with nothing between them that tells them apart:
//      `\w+\w+\w+`, `.*a.*b.*`. Two are allowed (at most a quadratic cost
//      on a bounded input; see 5).
//   4. Back-references (`\1`, `\k<name>`), whose matching can't be bounded.
//   5. Whatever passes is run only on answers up to PATTERN_INPUT_LIMIT
//      characters; a longer answer isn't checked against the pattern on the
//      server (the page has checked it in the visitor's browser).
//
// Character overlap is judged on the ASCII set plus one bucket for every
// other character, so anything outside ASCII counts as overlapping — the
// check errs towards calling a pattern slow. Repetitions with a maximum
// over 100 count as unbounded. A pattern the guard calls slow is skipped by
// the server (never fatal for the visitor) and reported in Proof, so
// whoever wrote it can simplify it. The site's own script in the browser
// keeps running the patterns it always did.

/** Answers longer than this are not checked against a pattern on the server. */
export const PATTERN_INPUT_LIMIT = 2000;

/** Why a pattern could be slow, by rule: see the comment above. */
export type PatternRisk = "nested" | "alternation" | "overlap" | "backreference";

/** What Proof and the form builder say about a pattern the guard refuses. */
export const PATTERN_RISK_MESSAGE = "This pattern could be slow enough to stall the site's form; simplify it.";

const UNBOUNDED = 101;
const ASCII = 128;
/** Bit 128 stands for every character outside ASCII. */
const OTHER = 1n << 128n;
const ALL = (1n << 129n) - 1n;

const bit = (code: number): bigint => (code < ASCII ? 1n << BigInt(code) : OTHER);

function range(from: number, to: number): bigint {
  let mask = 0n;

  for (let code = from; code <= Math.min(to, ASCII - 1); code += 1) mask |= 1n << BigInt(code);
  if (to >= ASCII) mask |= OTHER;
  return mask;
}

const DIGITS = range(48, 57);
const WORD = DIGITS | range(65, 90) | range(97, 122) | bit(95);
// \s covers ASCII space, \t \n \v \f \r and many non-ASCII spaces.
const SPACE = bit(32) | range(9, 13) | OTHER;

type Node =
  | { kind: "seq"; items: Node[] }
  | { kind: "alt"; options: Node[] }
  | { kind: "group"; body: Node; look: boolean }
  | { kind: "quant"; body: Node; min: number; max: number }
  | { kind: "char"; mask: bigint }
  | { kind: "backref" }
  | { kind: "empty" };

class Unreadable extends Error {}

/** A small parser for the patterns a form can hold (the `u` flag's syntax), enough to judge their shape. */
function parse(source: string): Node {
  let at = 0;
  const peek = () => source[at];
  const eat = (text: string) => {
    if (source.startsWith(text, at)) {
      at += text.length;
      return true;
    }
    return false;
  };

  const escapeMask = (inClass: boolean): bigint | "backref" | "empty" => {
    const char = source[at++];

    if (char === undefined) throw new Unreadable();
    switch (char) {
      case "d":
        return DIGITS;
      case "D":
        return ALL & ~DIGITS;
      case "w":
        return WORD;
      case "W":
        return ALL & ~WORD;
      case "s":
        return SPACE;
      case "S":
        return ALL & ~(SPACE & ~OTHER);
      case "b":
        return inClass ? bit(8) : "empty";
      case "B":
        return "empty";
      case "n":
        return bit(10);
      case "r":
        return bit(13);
      case "t":
        return bit(9);
      case "f":
        return bit(12);
      case "v":
        return bit(11);
      case "0":
        return bit(0);
      case "p":
      case "P":
        // A Unicode property: treated as overlapping everything.
        if (peek() === "{") {
          const end = source.indexOf("}", at);

          if (end < 0) throw new Unreadable();
          at = end + 1;
        }
        return ALL;
      case "k":
        if (!inClass && peek() === "<") {
          const end = source.indexOf(">", at);

          if (end < 0) throw new Unreadable();
          at = end + 1;
          return "backref";
        }
        return bit(107);
      case "x": {
        const hex = source.slice(at, at + 2);

        at += 2;
        return bit(Number.parseInt(hex, 16) || 0);
      }
      case "u": {
        if (peek() === "{") {
          const end = source.indexOf("}", at);

          if (end < 0) throw new Unreadable();
          const code = Number.parseInt(source.slice(at + 1, end), 16);

          at = end + 1;
          return bit(Number.isFinite(code) ? code : ASCII);
        }
        const code = Number.parseInt(source.slice(at, at + 4), 16);

        at += 4;
        return bit(Number.isFinite(code) ? code : ASCII);
      }
      case "c":
        at += 1;
        return range(0, 31);
      default:
        if (/[1-9]/.test(char) && !inClass) {
          while (/[0-9]/.test(peek() ?? "")) at += 1;
          return "backref";
        }
        return bit(char.codePointAt(0) ?? 0);
    }
  };

  const classMask = (): bigint => {
    const negated = eat("^");
    let mask = 0n;
    let first = true;

    for (;;) {
      const char = peek();

      if (char === undefined) throw new Unreadable();
      if (char === "]" && !first) {
        at += 1;
        break;
      }
      first = false;
      let low: bigint;
      let lowCode: number | null = null;

      if (char === "\\") {
        at += 1;
        const escaped = escapeMask(true);

        low = typeof escaped === "bigint" ? escaped : ALL;
        // A single escaped character can start a range (\x41-\x5a); a class like \d can't.
        lowCode = singleCode(low);
      } else {
        const code = source.codePointAt(at) ?? 0;

        at += code > 0xffff ? 2 : 1;
        low = bit(code);
        lowCode = code;
      }
      if (lowCode !== null && peek() === "-" && source[at + 1] !== "]" && source[at + 1] !== undefined) {
        at += 1;
        let highCode: number;

        if (peek() === "\\") {
          at += 1;
          const escaped = escapeMask(true);

          highCode = (typeof escaped === "bigint" ? singleCode(escaped) : null) ?? ASCII;
        } else {
          highCode = source.codePointAt(at) ?? 0;
          at += highCode > 0xffff ? 2 : 1;
        }
        mask |= range(lowCode, Math.max(lowCode, highCode));
        continue;
      }
      mask |= low;
    }
    return negated ? ALL & ~(mask & ~OTHER) : mask;
  };

  const quantifier = (): { min: number; max: number } | null => {
    const char = peek();
    let result: { min: number; max: number } | null = null;

    if (char === "*") result = { min: 0, max: Infinity };
    else if (char === "+") result = { min: 1, max: Infinity };
    else if (char === "?") result = { min: 0, max: 1 };
    else if (char === "{") {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at));

      if (!match) return null;
      const min = Number(match[1]);
      const max = match[2] === undefined ? min : match[3] === "" ? Infinity : Number(match[3]);

      at += match[0].length - 1;
      result = { min, max };
    }
    if (!result) return null;
    at += 1;
    eat("?");
    return result;
  };

  const atom = (): Node => {
    const char = peek();

    if (char === "(") {
      at += 1;
      let look = false;

      if (eat("?:")) look = false;
      else if (eat("?=") || eat("?!") || eat("?<=") || eat("?<!")) look = true;
      else if (eat("?<")) {
        const end = source.indexOf(">", at);

        if (end < 0) throw new Unreadable();
        at = end + 1;
      }
      const body = alternation();

      if (!eat(")")) throw new Unreadable();
      return { kind: "group", body, look };
    }
    if (char === "[") {
      at += 1;
      return { kind: "char", mask: classMask() };
    }
    if (char === ".") {
      at += 1;
      return { kind: "char", mask: ALL };
    }
    if (char === "^" || char === "$") {
      at += 1;
      return { kind: "empty" };
    }
    if (char === "\\") {
      at += 1;
      const escaped = escapeMask(false);

      if (escaped === "backref") return { kind: "backref" };
      if (escaped === "empty") return { kind: "empty" };
      return { kind: "char", mask: escaped };
    }
    if (char === undefined || char === "*" || char === "+" || char === "?" || char === ")" || char === "|") throw new Unreadable();
    const code = source.codePointAt(at) ?? 0;

    at += code > 0xffff ? 2 : 1;
    return { kind: "char", mask: bit(code) };
  };

  const sequence = (): Node => {
    const items: Node[] = [];

    while (at < source.length && peek() !== "|" && peek() !== ")") {
      const base = atom();
      const repeat = base.kind === "empty" ? null : quantifier();

      items.push(repeat ? { kind: "quant", body: base, min: repeat.min, max: repeat.max } : base);
    }
    return { kind: "seq", items };
  };

  function alternation(): Node {
    const options = [sequence()];

    while (eat("|")) options.push(sequence());
    return options.length === 1 ? options[0]! : { kind: "alt", options };
  }

  const tree = alternation();

  if (at !== source.length) throw new Unreadable();
  return tree;
}

/** The ASCII code a one-character mask stands for, or null (several characters, or a non-ASCII one). */
function singleCode(mask: bigint): number | null {
  if (mask === 0n || mask === OTHER || (mask & (mask - 1n)) !== 0n) return null;
  let code = 0;

  while (mask > 1n) {
    mask >>= 1n;
    code += 1;
  }
  return code;
}

const repeats = (node: Node): boolean => node.kind === "quant" && node.max > 1;
const unbounded = (node: Node): boolean => node.kind === "quant" && node.max >= UNBOUNDED;

function nullable(node: Node): boolean {
  switch (node.kind) {
    case "seq":
      return node.items.every(nullable);
    case "alt":
      return node.options.some(nullable);
    case "group":
      return node.look || nullable(node.body);
    case "quant":
      return node.min === 0 || nullable(node.body);
    case "char":
      return false;
    default:
      return true;
  }
}

/** Every character the node can consume. */
function chars(node: Node): bigint {
  switch (node.kind) {
    case "seq":
      return node.items.reduce((mask, item) => mask | chars(item), 0n);
    case "alt":
      return node.options.reduce((mask, option) => mask | chars(option), 0n);
    case "group":
      return node.look ? 0n : chars(node.body);
    case "quant":
      return chars(node.body);
    case "char":
      return node.mask;
    case "backref":
      return ALL;
    default:
      return 0n;
  }
}

/** The characters a match of the node can start with. */
function first(node: Node): bigint {
  switch (node.kind) {
    case "seq": {
      let mask = 0n;

      for (const item of node.items) {
        mask |= first(item);
        if (!nullable(item)) break;
      }
      return mask;
    }
    case "alt":
      return node.options.reduce((mask, option) => mask | first(option), 0n);
    case "group":
      return node.look ? 0n : first(node.body);
    case "quant":
      return first(node.body);
    case "char":
      return node.mask;
    case "backref":
      return ALL;
    default:
      return 0n;
  }
}

function contains(node: Node, test: (node: Node) => boolean): boolean {
  if (test(node)) return true;
  switch (node.kind) {
    case "seq":
      return node.items.some((item) => contains(item, test));
    case "alt":
      return node.options.some((option) => contains(option, test));
    case "group":
    case "quant":
      return contains(node.body, test);
    default:
      return false;
  }
}

/** The items of a pass, with plain groups opened up: `(\w+)(\w+)` is two items, not two groups. */
function flatten(node: Node): Node[] {
  if (node.kind === "seq") return node.items.flatMap(flatten);
  if (node.kind === "group" && !node.look && node.body.kind !== "alt") return flatten(node.body);
  return [node];
}

/** One mandatory character at the start or end of every pass that the rest of the pass can't contain. */
function delimited(body: Node): boolean {
  const items = flatten(body).filter((item) => !(item.kind === "group" && item.look) && item.kind !== "empty");

  if (items.length < 2) return false;
  const edge = (item: Node | undefined, rest: Node[]) =>
    item !== undefined && item.kind === "char" && rest.every((other) => (chars(other) & item.mask) === 0n);

  return edge(items[items.length - 1], items.slice(0, -1)) || edge(items[0], items.slice(1));
}

/** Rule 3: the longest run of unbounded repetitions in a sequence that could all take one character. */
function longestOverlap(items: Node[]): number {
  let best = 0;
  let count = 0;
  let shared = ALL;

  for (const item of items) {
    if (item.kind === "group" && item.look) continue;
    if (unbounded(item)) {
      const mask = chars(item);
      const next = shared & mask;

      if (count > 0 && next !== 0n) {
        count += 1;
        shared = next;
      } else {
        count = 1;
        shared = mask;
      }
      best = Math.max(best, count);
      continue;
    }
    // Something every match must pass through, that the run can't take, tells the runs apart.
    if (!nullable(item) && (chars(item) & shared) === 0n) {
      count = 0;
      shared = ALL;
    }
  }
  return best;
}

function judge(node: Node): PatternRisk | null {
  if (node.kind === "backref") return "backreference";
  if (node.kind === "quant" && repeats(node)) {
    const inner = (candidate: Node) => candidate !== node && candidate.kind === "quant" && (unbounded(node) ? repeats(candidate) : unbounded(candidate));

    if (contains(node.body, inner) && !delimited(node.body)) return "nested";
    const choices: Node[] = [];

    contains(node.body, (candidate) => {
      if (candidate.kind === "alt") choices.push(candidate);
      return false;
    });
    for (const choice of choices) {
      if (choice.kind !== "alt") continue;
      if (choice.options.some(nullable)) return "alternation";
      for (let i = 0; i < choice.options.length; i += 1) {
        for (let j = i + 1; j < choice.options.length; j += 1) {
          if ((first(choice.options[i]!) & first(choice.options[j]!)) !== 0n) return "alternation";
        }
      }
    }
  }
  if (node.kind === "seq" || node.kind === "group") {
    if (longestOverlap(flatten(node)) >= 3) return "overlap";
  }
  switch (node.kind) {
    case "seq":
      for (const item of node.items) {
        const found = judge(item);

        if (found) return found;
      }
      return null;
    case "alt":
      for (const option of node.options) {
        const found = judge(option);

        if (found) return found;
      }
      return null;
    case "group":
    case "quant":
      return judge(node.body);
    default:
      return null;
  }
}

/**
 * Why running `pattern` on a server could stall it, or null when the guard
 * finds it safe. A pattern that doesn't parse returns null too: whether it
 * compiles is a separate question (`compilePattern`).
 */
export function patternRisk(pattern: string): PatternRisk | null {
  let tree: Node;

  try {
    tree = parse(pattern);
  } catch {
    return null;
  }
  return judge(tree);
}

/** The pattern as the site's script runs it: the whole answer must match. Null when a browser couldn't compile it. */
export function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(`^(?:${pattern})$`, "u");
  } catch {
    return null;
  }
}

/**
 * Whether `text` matches `pattern` — or null when it isn't checked here: the
 * pattern doesn't compile, the guard calls it slow, or the answer is longer
 * than PATTERN_INPUT_LIMIT.
 */
export function matchesPattern(pattern: string, text: string): boolean | null {
  if (text.length > PATTERN_INPUT_LIMIT || patternRisk(pattern)) return null;
  const compiled = compilePattern(pattern);

  return compiled ? compiled.test(text) : null;
}

// ─────────────────────────────────────────────── which pages show a form

const FORM_KEYS = /^form(_?id)?$/i;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a search hit is a page naming this form (not a passing mention of the word). */
export function namesThisForm(hit: SearchHit, formId: string, formsCollection = "forms"): boolean {
  if (hit.collection === formsCollection) return false;
  if (hit.location.kind === "field") {
    const last = [...hit.location.field].reverse().find((segment) => typeof segment === "string");

    return typeof last === "string" && FORM_KEYS.test(last) && new RegExp(`(^|[^a-z0-9-])${escapeRegExp(formId)}($|[^a-z0-9-])`, "i").test(hit.excerpt);
  }
  // `form="x"`, `formId: x`, and the site kit's own `<Form id="x" />`.
  return new RegExp(`form(_?id|\\s+id)?\\s*[=:]\\s*["'{]?\\s*["']?${escapeRegExp(formId)}(?![a-z0-9-])`, "i").test(hit.excerpt);
}

/** The pages that use a form, one per page. */
export function pagesUsing(hits: readonly SearchHit[], formId: string, formsCollection = "forms"): SearchHit[] {
  const seen = new Set<string>();

  return hits.filter((hit) => {
    if (!namesThisForm(hit, formId, formsCollection) || seen.has(hit.path)) return false;
    seen.add(hit.path);
    return true;
  });
}

type Data = { [key: string]: JsonValue };
const isData = (value: unknown): value is Data => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a schema field names a form: a reference into the forms collection, or a text field called `form` / `formId`. */
export function isFormField(field: Field, formsCollection = "forms"): boolean {
  if (field.type === "reference") return field.collection === formsCollection;
  return FORM_KEYS.test(field.key) && (field.type === "string" || field.type === "select");
}

/**
 * The form id a stored value names. Sections write `"stockist"`, but the
 * starters' components also take `{ id: "stockist" }` (what an Astro
 * reference resolves to), and hand-written files sometimes keep the file's
 * path (`forms/stockist.json`).
 */
export function formIdOf(value: unknown): string | null {
  if (typeof value === "string") {
    const id = value.trim().split("/").pop()!.replace(/\.json$/i, "");

    return id === "" ? null : id;
  }
  if (isData(value)) {
    for (const key of ["id", "slug"]) if (typeof value[key] === "string") return formIdOf(value[key]);
  }
  return null;
}

/**
 * Every form an entry's fields show, read from its data rather than from
 * search hits: the search keeps three hits per file, so a page that says
 * "stockists" three times never reached the section naming the form. With
 * the collection's schema it also counts the sections that name no form and
 * show their field's default (a Contact section without `form` shows
 * "contact"); without one, any `form` / `formId` key counts.
 */
export function formsNamedIn(data: Data, fields: readonly Field[] = [], formsCollection = "forms"): string[] {
  const found = new Set<string>();
  const add = (value: unknown) => {
    const id = formIdOf(value);

    if (id) found.add(id);
  };
  const visitLoose = (value: JsonValue): void => {
    if (Array.isArray(value)) value.forEach(visitLoose);
    else if (isData(value)) visitObject(value, []);
  };
  const visitField = (value: JsonValue, field: Field): void => {
    if (isFormField(field, formsCollection)) {
      if (Array.isArray(value)) value.forEach(add);
      else add(value);
      return;
    }
    if (field.type === "blocks" && Array.isArray(value)) {
      const discriminator = field.discriminator ?? "type";

      for (const item of value) {
        if (!isData(item)) continue;
        visitObject(item, field.blocks?.find((block) => block.type === item[discriminator])?.fields ?? []);
      }
      return;
    }
    if (field.type === "object" && isData(value)) {
      visitObject(value, field.fields ?? []);
      return;
    }
    if (field.type === "list" && field.of && Array.isArray(value)) {
      for (const item of value) visitField(item, field.of);
      return;
    }
    visitLoose(value);
  };
  const visitObject = (object: Data, schema: readonly Field[]): void => {
    const described = new Set<string>();

    for (const field of schema) {
      described.add(field.key);
      const value = object[field.key];

      if (value === undefined || value === null || value === "") {
        // The site renders the default when the field is left out.
        if (isFormField(field, formsCollection) && field.default !== undefined) add(field.default);
        continue;
      }
      visitField(value, field);
    }
    for (const [key, value] of Object.entries(object)) {
      if (described.has(key)) continue;
      if (FORM_KEYS.test(key)) add(value);
      else visitLoose(value);
    }
  };

  visitObject(data, fields);
  return [...found];
}

// ─────────────────────────────────────────────── the first form of a site

/** The form "Set it up for me" adds, and the form builder's "Contact" starter: name, email, a message, to the inbox. */
export const CONTACT_FORM: FormDefinition = {
  name: "Contact",
  fields: [
    { id: "name", type: "text", label: "Name", required: true, width: "half" },
    { id: "email", type: "email", label: "Email", required: true, width: "half" },
    { id: "message", type: "textarea", label: "Message", required: true },
  ],
  submitLabel: "Send message",
  destinations: [{ provider: "galley", settings: {} }],
  afterSubmit: [{ type: "message", title: "Thank you", text: "We’ll reply within two working days." }],
};
