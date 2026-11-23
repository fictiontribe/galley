/**
 * A tolerant parser for the small subset of JavaScript a content config is
 * written in: imports, const declarations, exports, calls, member chains,
 * object/array literals and arrow functions. Anything else is parsed as
 * `unknown` and skipped, so an unusual line never stops the rest of the file
 * from being read. It never executes anything.
 */
import { tokenize, type Token } from "./tokens";

export type Expr =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "ident"; name: string }
  | { kind: "member"; object: Expr; property: string }
  | { kind: "call"; callee: Expr; args: Expr[] }
  | { kind: "new"; callee: Expr; args: Expr[] }
  | { kind: "object"; props: Array<{ key: string; value: Expr } | { spread: Expr }> }
  | { kind: "array"; items: Expr[] }
  | { kind: "arrow"; params: string[]; body: Expr }
  /**
   * `a || b` and `a ?? b`. Kept (rather than folded into `unknown`) because
   * configs write defaults this way — `process.env.SITE_URL || "https://…"` —
   * and the right-hand side is then the value a plain local run uses.
   */
  | { kind: "logical"; operator: "||" | "??"; left: Expr; right: Expr }
  | { kind: "unknown" };

export interface Program {
  /** Top-level `const/let/var name = expr` declarations. */
  scope: Map<string, Expr>;
  /** Exported name → local name. */
  exports: Map<string, string>;
  /** Local names bound by imports, with the module they come from. */
  imports: Map<string, { from: string; imported: string }>;
}

const UNKNOWN: Expr = { kind: "unknown" };
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const BINARY = new Set([
  "+", "-", "*", "/", "%", "**", "==", "!=", "===", "!==", "<", ">", "<=", ">=", "&&", "||", "??", "&", "|", "^", "<<", ">>", ">>>", "instanceof", "in",
]);

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private is(value: string, offset = 0): boolean {
    const token = this.peek(offset);

    return token !== undefined && (token.type === "punct" || token.type === "ident") && token.value === value;
  }

  private next(): Token | undefined {
    const token = this.tokens[this.index];

    this.index += 1;
    return token;
  }

  get done(): boolean {
    return this.index >= this.tokens.length;
  }

  /** Index of the token that closes the bracket at `from`, or the end. */
  private matching(from: number): number {
    let depth = 0;

    for (let i = from; i < this.tokens.length; i += 1) {
      const token = this.tokens[i]!;

      if (token.type !== "punct") continue;
      if (OPEN[token.value]) depth += 1;
      else if (token.value === ")" || token.value === "]" || token.value === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return this.tokens.length - 1;
  }

  private skipBalanced(): void {
    this.index = this.matching(this.index) + 1;
  }

  /** Skips a TypeScript type: up to a `,` `)` `]` `}` `;` or `=` at depth zero. */
  private skipType(): void {
    let depth = 0;

    while (!this.done) {
      const token = this.peek()!;

      if (token.type === "punct") {
        if (depth === 0 && [",", ")", "]", "}", ";", "="].includes(token.value)) return;
        if (OPEN[token.value] || token.value === "<") depth += 1;
        else if (token.value === ")" || token.value === "]" || token.value === "}" || token.value === ">") depth -= 1;
        else if (token.value === ">>") depth -= 2;
      }
      this.next();
    }
  }

  /** Moves past the current statement after a parse failure. */
  recover(): void {
    while (!this.done) {
      const token = this.peek()!;

      if (token.type === "punct" && OPEN[token.value]) {
        this.skipBalanced();
        continue;
      }
      this.next();
      if (token.type === "punct" && token.value === ";") return;
      const following = this.peek();

      if (following && following.type === "ident" && ["import", "export", "const", "let", "var", "function", "type", "interface"].includes(following.value)) return;
    }
  }

  expression(): Expr {
    let left = this.unary();

    for (let guard = 0; guard < 10_000 && !this.done; guard += 1) {
      const token = this.peek()!;

      if ((token.type === "punct" || token.type === "ident") && BINARY.has(token.value)) {
        this.next();
        const right = this.unary();

        // Only a fallback keeps its parts; any other operator makes the value unknowable.
        left = token.value === "||" || token.value === "??" ? { kind: "logical", operator: token.value, left, right } : UNKNOWN;
        continue;
      }
      if (this.is("?")) {
        this.next();
        this.expression();
        if (this.is(":")) {
          this.next();
          this.expression();
        }
        left = UNKNOWN;
        continue;
      }
      break;
    }
    return left;
  }

  private unary(): Expr {
    const token = this.peek();

    if (!token) return UNKNOWN;
    if (token.type === "punct" && token.value === "-" && this.peek(1)?.type === "number") {
      this.next();
      const number = this.next()!;

      return { kind: "number", value: -Number(number.value.replace(/_/g, "")) };
    }
    if ((token.type === "punct" && ["!", "-", "+", "~"].includes(token.value)) || (token.type === "ident" && ["typeof", "void", "await", "delete"].includes(token.value))) {
      this.next();
      this.unary();
      return UNKNOWN;
    }
    if (token.type === "ident" && token.value === "new") {
      this.next();
      let callee = this.primary();

      while (this.is(".")) {
        this.next();
        callee = { kind: "member", object: callee, property: this.next()?.value ?? "" };
      }
      const args = this.is("(") ? this.args() : [];

      return this.postfix({ kind: "new", callee, args });
    }
    return this.postfix(this.primary());
  }

  private args(): Expr[] {
    const args: Expr[] = [];

    this.next();
    while (!this.done && !this.is(")")) {
      if (this.is("...")) this.next();
      args.push(this.expression());
      if (this.is(",")) this.next();
      else if (!this.is(")")) {
        this.recoverTo(")");
        break;
      }
    }
    this.next();
    return args;
  }

  /** Skips forward to the given closer at the current depth (exclusive). */
  private recoverTo(closer: string): void {
    while (!this.done && !this.is(closer)) {
      const token = this.peek()!;

      if (token.type === "punct" && OPEN[token.value]) this.skipBalanced();
      else this.next();
    }
  }

  private postfix(start: Expr): Expr {
    let expr = start;

    for (let guard = 0; guard < 10_000 && !this.done; guard += 1) {
      if (this.is(".") || this.is("?.")) {
        this.next();
        if (this.is("(")) {
          expr = { kind: "call", callee: expr, args: this.args() };
          continue;
        }
        const property = this.next();

        expr = { kind: "member", object: expr, property: property?.value ?? "" };
        continue;
      }
      if (this.is("(")) {
        expr = { kind: "call", callee: expr, args: this.args() };
        continue;
      }
      if (this.is("<") && expr.kind !== "unknown" && this.looksLikeTypeArguments()) {
        this.skipTypeArguments();
        continue;
      }
      if (this.is("[")) {
        this.next();
        const key = this.expression();

        this.recoverTo("]");
        this.next();
        expr = key.kind === "string" ? { kind: "member", object: expr, property: key.value } : UNKNOWN;
        continue;
      }
      if (this.is("!") && !this.is("=", 1)) {
        this.next();
        continue;
      }
      if (this.is("as") || this.is("satisfies")) {
        this.next();
        this.skipType();
        continue;
      }
      if (this.peek()?.type === "template") {
        this.next();
        expr = UNKNOWN;
        continue;
      }
      break;
    }
    return expr;
  }

  /** `defineCollection<…>(` — angle brackets immediately followed by a call. */
  private looksLikeTypeArguments(): boolean {
    let depth = 0;

    for (let i = this.index; i < this.tokens.length && i < this.index + 200; i += 1) {
      const token = this.tokens[i]!;

      if (token.type !== "punct") continue;
      if (token.value === "<") depth += 1;
      else if (token.value === ">") depth -= 1;
      else if (token.value === ">>") depth -= 2;
      else if ([";", "{", "}"].includes(token.value) && depth > 0 && token.value !== "{") return false;
      if (depth <= 0) return this.tokens[i + 1]?.value === "(";
    }
    return false;
  }

  private skipTypeArguments(): void {
    let depth = 0;

    while (!this.done) {
      const token = this.next()!;

      if (token.type !== "punct") continue;
      if (token.value === "<") depth += 1;
      else if (token.value === ">") depth -= 1;
      else if (token.value === ">>") depth -= 2;
      if (depth <= 0) return;
    }
  }

  private arrowParams(): string[] | null {
    // Called at "(": is this an arrow function's parameter list?
    const close = this.matching(this.index);
    const after = this.tokens[close + 1];

    if (!after) return null;
    let arrowAt = close + 1;

    if (after.type === "punct" && after.value === ":") {
      // Return type annotation: find "=>" at depth zero.
      let depth = 0;

      for (let i = close + 2; i < this.tokens.length; i += 1) {
        const token = this.tokens[i]!;

        if (token.type !== "punct") continue;
        if (OPEN[token.value] || token.value === "<") depth += 1;
        else if ([")", "]", "}", ">"].includes(token.value)) depth -= 1;
        else if (token.value === "=>" && depth === 0) {
          arrowAt = i;
          break;
        }
        if (depth < 0) return null;
      }
    }
    const arrow = this.tokens[arrowAt];

    if (!arrow || arrow.type !== "punct" || arrow.value !== "=>") return null;
    const names = this.paramNames(this.index, close);

    this.index = arrowAt + 1;
    return names;
  }

  /** Parameter names between the bracket at `open` and its closer (destructured names included). */
  private paramNames(open: number, close: number): string[] {
    return this.tokens
      .slice(open + 1, close)
      .filter((token, position, all) => token.type === "ident" && all[position - 1]?.value !== ":")
      .map((token) => token.value);
  }

  /**
   * `function name(a, b) { …; return x }` — read like an arrow function whose
   * body is the first top-level `return`, so a config that exports a
   * function (Eleventy's `module.exports = function (config) { return {…} }`)
   * or wraps a schema in one stays readable.
   */
  functionExpression(): { name: string | null; fn: Expr } {
    this.next();
    if (this.is("*")) this.next();
    const name = this.peek()?.type === "ident" && !this.is("(") ? this.next()!.value : null;

    if (this.is("<")) this.skipTypeArguments();
    if (!this.is("(")) return { name, fn: UNKNOWN };
    const close = this.matching(this.index);
    const params = this.paramNames(this.index, close);

    this.index = close + 1;
    if (this.is(":")) {
      this.next();
      // A return type ends at the body's opening brace.
      while (!this.done && !this.is("{")) {
        if (this.is("<")) this.skipTypeArguments();
        else if (this.peek()?.type === "punct" && OPEN[this.peek()!.value]) this.skipBalanced();
        else this.next();
      }
    }
    if (!this.is("{")) return { name, fn: UNKNOWN };
    return { name, fn: this.arrowBody(params) };
  }

  private arrowBody(params: string[]): Expr {
    if (this.is("{")) {
      // Block body: the expression after the first top-level `return`.
      const close = this.matching(this.index);
      let depth = 0;

      for (let i = this.index; i < close; i += 1) {
        const token = this.tokens[i]!;

        if (token.type === "punct" && OPEN[token.value]) depth += 1;
        else if (token.type === "punct" && [")", "]", "}"].includes(token.value)) depth -= 1;
        else if (depth === 1 && token.type === "ident" && token.value === "return") {
          this.index = i + 1;
          const body = this.expression();

          this.index = close + 1;
          return { kind: "arrow", params, body };
        }
      }
      this.index = close + 1;
      return { kind: "arrow", params, body: UNKNOWN };
    }
    return { kind: "arrow", params, body: this.expression() };
  }

  private primary(): Expr {
    const token = this.peek();

    if (!token) return UNKNOWN;
    switch (token.type) {
      case "string":
        this.next();
        return { kind: "string", value: token.value };
      case "template":
        this.next();
        return token.dynamic ? UNKNOWN : { kind: "string", value: token.value };
      case "number":
        this.next();
        return { kind: "number", value: Number(token.value.replace(/_/g, "").replace(/n$/, "")) };
      case "regex":
        this.next();
        return UNKNOWN;
      case "ident": {
        if (token.value === "async" && (this.is("(", 1) || this.is("function", 1) || (this.peek(1)?.type === "ident" && this.is("=>", 2)))) {
          this.next();
          return this.primary();
        }
        if (this.is("=>", 1)) {
          this.next();
          this.next();
          return this.arrowBody([token.value]);
        }
        if (token.value === "function") return this.functionExpression().fn;
        this.next();
        if (token.value === "true" || token.value === "false") return { kind: "bool", value: token.value === "true" };
        if (token.value === "null" || token.value === "undefined") return { kind: "null" };
        return { kind: "ident", name: token.value };
      }
      case "punct": {
        if (token.value === "(") {
          const params = this.arrowParams();

          if (params) return this.arrowBody(params);
          this.next();
          const inner = this.expression();

          this.recoverTo(")");
          this.next();
          return inner;
        }
        if (token.value === "{") return this.object();
        if (token.value === "[") return this.array();
        if (token.value === "<") {
          // A generic arrow `<T>(…) =>` or a JSX element: neither is content config.
          this.skipTypeArguments();
          return this.primary();
        }
        this.next();
        return UNKNOWN;
      }
    }
  }

  private object(): Expr {
    const props: Array<{ key: string; value: Expr } | { spread: Expr }> = [];

    this.next();
    while (!this.done && !this.is("}")) {
      if (this.is("...")) {
        this.next();
        props.push({ spread: this.expression() });
      } else {
        const keyToken = this.next()!;
        let key: string | null = null;

        if (keyToken.type === "ident" || keyToken.type === "string" || keyToken.type === "number") key = keyToken.value;
        else if (keyToken.type === "punct" && keyToken.value === "[") {
          this.index -= 1;
          this.skipBalanced();
        }
        if ((keyToken.value === "get" || keyToken.value === "set" || keyToken.value === "async") && this.peek()?.type === "ident" && this.is("(", 1)) {
          this.next();
          this.skipBalanced();
          if (this.is("{")) this.skipBalanced();
          key = null;
        } else if (this.is("?")) this.next();
        if (this.is(":")) {
          this.next();
          const value = this.expression();

          if (key !== null) props.push({ key, value });
        } else if (this.is("(")) {
          // Method shorthand: name(…) { … }
          this.skipBalanced();
          if (this.is(":")) this.skipType();
          if (this.is("{")) this.skipBalanced();
        } else if (key !== null && keyToken.type === "ident") {
          props.push({ key, value: { kind: "ident", name: key } });
          if (this.is("=")) {
            this.next();
            this.expression();
          }
        }
      }
      if (this.is(",")) this.next();
      else if (!this.is("}")) this.recoverTo("}");
    }
    this.next();
    return { kind: "object", props };
  }

  private array(): Expr {
    const items: Expr[] = [];

    this.next();
    while (!this.done && !this.is("]")) {
      if (this.is(",")) {
        this.next();
        continue;
      }
      if (this.is("...")) this.next();
      items.push(this.expression());
      if (this.is(",")) this.next();
      else if (!this.is("]")) this.recoverTo("]");
    }
    this.next();
    return { kind: "array", items };
  }

  private importStatement(program: Program): void {
    this.next();
    if (this.is("type")) this.next();
    const names: Array<{ local: string; imported: string }> = [];

    if (this.peek()?.type === "string") {
      this.next();
      return;
    }
    if (this.peek()?.type === "ident" && !this.is("from")) {
      const name = this.next()!.value;

      names.push({ local: name, imported: "default" });
      if (this.is(",")) this.next();
    }
    if (this.is("*")) {
      this.next();
      if (this.is("as")) this.next();
      const name = this.next()?.value;

      if (name) names.push({ local: name, imported: "*" });
    }
    if (this.is("{")) {
      this.next();
      while (!this.done && !this.is("}")) {
        if (this.is("type")) this.next();
        const imported = this.next()?.value ?? "";
        let local = imported;

        if (this.is("as")) {
          this.next();
          local = this.next()?.value ?? imported;
        }
        names.push({ local, imported });
        if (this.is(",")) this.next();
      }
      this.next();
    }
    if (this.is("from")) this.next();
    const from = this.peek()?.type === "string" ? this.next()!.value : "";

    for (const name of names) program.imports.set(name.local, { from, imported: name.imported });
    if (this.is("with") || this.is("assert")) {
      this.next();
      if (this.is("{")) this.skipBalanced();
    }
  }

  private declaration(program: Program, exported: boolean): void {
    this.next();
    for (;;) {
      if (this.peek()?.type === "ident") {
        const name = this.next()!.value;

        if (this.is("!")) this.next();
        if (this.is(":")) {
          this.next();
          this.skipType();
        }
        if (this.is("=")) {
          this.next();
          program.scope.set(name, this.expression());
        }
        if (exported) program.exports.set(name, name);
      } else if (this.is("{") || this.is("[")) {
        this.skipBalanced();
        if (this.is("=")) {
          this.next();
          this.expression();
        }
      } else {
        this.recover();
        return;
      }
      if (this.is(",")) {
        this.next();
        continue;
      }
      break;
    }
    if (this.is(";")) this.next();
  }

  /** A top-level `function name() {}` (optionally `async`) becomes a binding like a const would. */
  private functionDeclaration(program: Program, exported: boolean): void {
    if (this.is("async")) this.next();
    const { name, fn } = this.functionExpression();

    if (name) {
      program.scope.set(name, fn);
      if (exported) program.exports.set(name, name);
    }
  }

  private exportStatement(program: Program): void {
    this.next();
    if (this.is("const") || this.is("let") || this.is("var")) {
      this.declaration(program, true);
      return;
    }
    if (this.is("function") || (this.is("async") && this.is("function", 1))) {
      this.functionDeclaration(program, true);
      return;
    }
    if (this.is("default")) {
      this.next();
      program.scope.set("default", this.expression());
      program.exports.set("default", "default");
      if (this.is(";")) this.next();
      return;
    }
    if (this.is("{")) {
      this.next();
      while (!this.done && !this.is("}")) {
        if (this.is("type")) this.next();
        const local = this.next()?.value ?? "";
        let exportedName = local;

        if (this.is("as")) {
          this.next();
          exportedName = this.next()?.value ?? local;
        }
        program.exports.set(exportedName, local);
        if (this.is(",")) this.next();
      }
      this.next();
      if (this.is("from")) {
        this.next();
        this.next();
      }
      if (this.is(";")) this.next();
      return;
    }
    this.recover();
  }

  /**
   * `module.exports = x`, `module.exports.name = x` and `exports.name = x`:
   * CommonJS configs (Eleventy, Docusaurus, older Next.js) export this way.
   * Recorded as if they were `export default x` / `export const name = x`.
   */
  private commonJsExport(program: Program): boolean {
    let name: string | null = null;
    let length = 0;

    if (this.is("module") && this.is(".", 1) && this.is("exports", 2)) {
      if (this.is("=", 3)) {
        name = "default";
        length = 4;
      } else if (this.is(".", 3) && this.peek(4)?.type === "ident" && this.is("=", 5)) {
        name = this.peek(4)!.value;
        length = 6;
      }
    } else if (this.is("exports") && this.is(".", 1) && this.peek(2)?.type === "ident" && this.is("=", 3)) {
      name = this.peek(2)!.value;
      length = 4;
    }
    if (name === null) return false;
    this.index += length;
    program.scope.set(name, this.expression());
    program.exports.set(name, name);
    if (this.is(";")) this.next();
    return true;
  }

  program(): Program {
    const program: Program = { scope: new Map(), exports: new Map(), imports: new Map() };

    for (let guard = 0; guard < 100_000 && !this.done; guard += 1) {
      const before = this.index;

      try {
        if (this.is("import") && !this.is("(", 1) && !this.is(".", 1)) this.importStatement(program);
        else if (this.is("export")) this.exportStatement(program);
        else if (this.is("const") || this.is("let") || this.is("var")) this.declaration(program, false);
        else if (this.is("function") || (this.is("async") && this.is("function", 1))) this.functionDeclaration(program, false);
        else if (this.commonJsExport(program)) continue;
        else if (this.is("type") || this.is("interface") || this.is("declare")) this.recover();
        else if (this.is(";")) this.next();
        else {
          this.expression();
          if (this.is(";")) this.next();
        }
      } catch {
        this.index = before;
        this.recover();
      }
      if (this.index === before) this.next();
    }
    return program;
  }
}

export function parseProgram(source: string): Program {
  return new Parser(tokenize(source)).program();
}

/**
 * Follows identifiers through top-level declarations (a few hops, no cycles),
 * and `a.b` into object literals — so `site.url`, where `site` is an object
 * (or an imported JSON file), resolves to the string it holds.
 */
export function resolve(expr: Expr, scope: Map<string, Expr>, depth = 0): Expr {
  if (depth >= 12) return expr;
  if (expr.kind === "ident") {
    const bound = scope.get(expr.name);

    if (bound && bound !== expr) return resolve(bound, scope, depth + 1);
  }
  if (expr.kind === "member") {
    const object = resolve(expr.object, scope, depth + 1);
    const value = object.kind === "object" ? propOf(object, expr.property) : undefined;

    if (value) return resolve(value, scope, depth + 1);
  }
  return expr;
}

/** "glob", "z.string", "z.coerce.date" — the dotted name of a callee, when it is one. */
export function calleeName(expr: Expr): string | null {
  if (expr.kind === "ident") return expr.name;
  if (expr.kind === "member") {
    const object = calleeName(expr.object);

    return object === null ? null : `${object}.${expr.property}`;
  }
  return null;
}

export function stringOf(expr: Expr | undefined): string | null {
  return expr && expr.kind === "string" ? expr.value : null;
}

export function propOf(expr: Expr, key: string): Expr | undefined {
  if (expr.kind !== "object") return undefined;
  for (const prop of expr.props) {
    if ("key" in prop && prop.key === key) return prop.value;
  }
  return undefined;
}
