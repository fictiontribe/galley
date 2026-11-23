/**
 * A tolerant JavaScript/TypeScript tokenizer — just enough to read a content
 * config statically. It never throws: anything it does not recognise becomes
 * a one-character punctuation token, and the parser above it skips what it
 * cannot use.
 */

export type TokenType = "ident" | "string" | "number" | "punct" | "template" | "regex";

export interface Token {
  type: TokenType;
  /** Identifier name, punctuator, number text, or a string's decoded value. */
  value: string;
  start: number;
  end: number;
  /** template: true when it holds `${…}` (its value is then not a constant). */
  dynamic?: boolean;
}

const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
];

const KEYWORDS_BEFORE_EXPRESSION = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "await", "yield", "export", "default"]);

function decodeString(body: string): string {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r?\n|.)/g, (_, escape: string) => {
    if (escape.startsWith("u{")) return String.fromCodePoint(Number.parseInt(escape.slice(2, -1), 16));
    if (escape.startsWith("u") && escape.length === 5) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    if (escape.startsWith("x") && escape.length === 3) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    if (escape === "\n" || escape === "\r\n") return "";
    return ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[escape] ?? escape;
  });
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const length = source.length;

  const regexAllowed = (): boolean => {
    const previous = tokens[tokens.length - 1];

    if (!previous) return true;
    if (previous.type === "punct") return ![")", "]", "}"].includes(previous.value);
    if (previous.type === "ident") return KEYWORDS_BEFORE_EXPRESSION.has(previous.value);
    return false;
  };

  while (i < length) {
    const char = source[i]!;

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);

      i = newline === -1 ? length : newline;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);

      i = close === -1 ? length : close + 2;
      continue;
    }
    const start = i;

    if (char === '"' || char === "'") {
      i += 1;
      while (i < length && source[i] !== char && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
      tokens.push({ type: "string", value: decodeString(source.slice(start + 1, i)), start, end: i + 1 });
      i += 1;
      continue;
    }
    if (char === "`") {
      i += 1;
      let dynamic = false;
      let depth = 0;

      while (i < length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (depth === 0 && source[i] === "`") break;
        if (source[i] === "$" && source[i + 1] === "{") {
          dynamic = true;
          depth += 1;
          i += 2;
          continue;
        }
        if (depth > 0 && source[i] === "}") depth -= 1;
        i += 1;
      }
      tokens.push({ type: "template", value: dynamic ? "" : decodeString(source.slice(start + 1, i)), start, end: i + 1, dynamic });
      i += 1;
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const match = /^(0[xXoObB][0-9a-fA-F_]+|[0-9_]*\.?[0-9_]+([eE][+-]?[0-9]+)?n?)/.exec(source.slice(i));
      const text = match ? match[0] : char;

      i += text.length;
      tokens.push({ type: "number", value: text, start, end: i });
      continue;
    }
    if (/[A-Za-z_$À-￿]/.test(char)) {
      const match = /^[A-Za-z0-9_$À-￿]+/.exec(source.slice(i))!;

      i += match[0].length;
      tokens.push({ type: "ident", value: match[0], start, end: i });
      continue;
    }
    if (char === "/" && regexAllowed()) {
      let inClass = false;

      i += 1;
      while (i < length && source[i] !== "\n") {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "/" && !inClass) break;
        i += 1;
      }
      i += 1;
      while (i < length && /[a-z]/i.test(source[i]!)) i += 1;
      tokens.push({ type: "regex", value: source.slice(start, i), start, end: i });
      continue;
    }
    const punct = PUNCTUATORS.find((candidate) => source.startsWith(candidate, i)) ?? char;

    i += punct.length;
    tokens.push({ type: "punct", value: punct, start, end: i });
  }
  return tokens;
}
