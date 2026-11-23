// A small GraphQL reader and executor for the fake store: just enough of the
// language for the documents the plugin, the starter and the seed script
// send (operations with variables, fields with arguments and aliases,
// inline fragments, __typename), checked against a schema the fake
// declares from Shopify's reference pages. A field that isn't in the
// schema, a deprecated field, or an argument the field doesn't take is an
// error here — that is what makes the fake strict.

const PUNCT = new Set(["{", "}", "(", ")", ":", "$", "!", ",", "=", "[", "]", "@"]);

/** Splits a document into tokens. Comments and commas are whitespace, as in GraphQL. */
function tokenize(text) {
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (/\s|,/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text.startsWith("...", i)) {
      tokens.push({ kind: "spread" });
      i += 3;
      continue;
    }
    if (PUNCT.has(ch)) {
      tokens.push({ kind: "punct", value: ch });
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let out = "";

      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") {
          out += JSON.parse(`"${text.slice(j, j + 2)}"`);
          j += 2;
          continue;
        }
        out += text[j++];
      }
      tokens.push({ kind: "string", value: out });
      i = j + 1;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(text.slice(i));

    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const name = /^[_A-Za-z][_0-9A-Za-z]*/.exec(text.slice(i));

    if (!name) throw new GraphQLError(`Syntax error: unexpected character “${ch}”.`, "PARSE_ERROR");
    tokens.push({ kind: "name", value: name[0] });
    i += name[0].length;
  }
  return tokens;
}

export class GraphQLError extends Error {
  constructor(message, code = "GRAPHQL_VALIDATION_FAILED", extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/** Reads one operation (the documents here never hold more than one, and no named fragments). */
export function parse(text) {
  const tokens = tokenize(text);
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const expect = (value) => {
    const token = next();

    if (!token || token.value !== value) throw new GraphQLError(`Syntax error: expected “${value}”.`, "PARSE_ERROR");
  };
  const isPunct = (value) => peek()?.kind === "punct" && peek().value === value;

  function value() {
    const token = next();

    if (!token) throw new GraphQLError("Syntax error: unexpected end.", "PARSE_ERROR");
    if (token.kind === "punct" && token.value === "$") return { variable: next().value };
    if (token.kind === "string" || token.kind === "number") return { literal: token.value };
    if (token.kind === "name") {
      if (token.value === "true" || token.value === "false") return { literal: token.value === "true" };
      if (token.value === "null") return { literal: null };
      return { literal: token.value };
    }
    if (token.value === "[") {
      const list = [];

      while (!isPunct("]")) list.push(value());
      next();
      return { list };
    }
    if (token.value === "{") {
      const object = {};

      while (!isPunct("}")) {
        const key = next().value;

        expect(":");
        object[key] = value();
      }
      next();
      return { object };
    }
    throw new GraphQLError("Syntax error: unexpected token.", "PARSE_ERROR");
  }

  function args() {
    const out = {};

    if (!isPunct("(")) return out;
    next();
    while (!isPunct(")")) {
      const key = next().value;

      expect(":");
      out[key] = value();
    }
    next();
    return out;
  }

  function directives() {
    while (isPunct("@")) {
      next();
      next();
      args();
    }
  }

  function selections() {
    const list = [];

    expect("{");
    while (!isPunct("}")) {
      if (peek()?.kind === "spread") {
        next();
        const on = next();

        if (on?.value !== "on") throw new GraphQLError("Named fragments aren't supported by this fake; use an inline fragment.", "PARSE_ERROR");
        const type = next().value;

        list.push({ kind: "inline", type, selections: selections() });
        continue;
      }
      let name = next().value;
      let alias = name;

      if (isPunct(":")) {
        next();
        name = next().value;
      }
      const fieldArgs = args();

      directives();
      list.push({ kind: "field", name, alias, args: fieldArgs, selections: isPunct("{") ? selections() : null });
    }
    next();
    return list;
  }

  let operation = "query";
  let name = null;
  const variables = [];

  if (peek()?.kind === "name" && (peek().value === "query" || peek().value === "mutation")) {
    operation = next().value;
    if (peek()?.kind === "name") name = next().value;
    if (isPunct("(")) {
      next();
      while (!isPunct(")")) {
        expect("$");
        const variable = next().value;

        expect(":");
        let type = "";

        while (!isPunct(")") && !isPunct("$") && !isPunct("=")) type += next().value;
        if (isPunct("=")) {
          next();
          value();
        }
        variables.push({ name: variable, type });
      }
      next();
    }
    directives();
  }
  const root = selections();

  if (at !== tokens.length) throw new GraphQLError("Syntax error: only one operation per document.", "PARSE_ERROR");
  return { operation, name, variables, selections: root };
}

/** Resolves an argument's parsed value against the request's variables. */
export function resolveValue(node, variables) {
  if ("variable" in node) {
    if (!(node.variable in variables)) return undefined;
    return variables[node.variable];
  }
  if ("literal" in node) return node.literal;
  if ("list" in node) return node.list.map((item) => resolveValue(item, variables));
  return Object.fromEntries(Object.entries(node.object).map(([key, item]) => [key, resolveValue(item, variables)]));
}

/** Every variable the document uses must be declared, and every declared non-null one given. */
function checkVariables(document, variables) {
  const declared = new Map(document.variables.map((variable) => [variable.name, variable.type]));
  const used = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if ("variable" in node) used.add(node.variable);
    if ("list" in node) node.list.forEach(walk);
    if ("object" in node) Object.values(node.object).forEach(walk);
  };
  const visit = (list) => {
    for (const selection of list ?? []) {
      if (selection.kind === "field") Object.values(selection.args).forEach(walk);
      visit(selection.selections);
    }
  };

  visit(document.selections);
  for (const name of used) if (!declared.has(name)) throw new GraphQLError(`Variable $${name} is used but not declared.`);
  for (const [name, type] of declared) {
    if (type.endsWith("!") && (variables[name] === undefined || variables[name] === null)) throw new GraphQLError(`Variable $${name} of type ${type} was provided invalid value.`, "INVALID_VARIABLE");
  }
}

/**
 * Validates the selections against `schema` ({ Type: { field: { type, args?, deprecated?, check? } } }).
 * `check(field, context)` may throw for access rules (a token, a scope). Returns the cost: one point a
 * field, connections multiplied by `first`.
 */
function validate(schema, typeName, list, context, path) {
  const type = schema[typeName];
  let cost = 0;

  if (!type) throw new GraphQLError(`The fake has no type ${typeName}.`);
  for (const selection of list) {
    if (selection.kind === "inline") {
      const allowed = type.__possible ?? [typeName];

      if (!allowed.includes(selection.type)) throw new GraphQLError(`Fragment on ${selection.type} can't be spread inside ${typeName}.`);
      cost += validate(schema, selection.type, selection.selections, context, path);
      continue;
    }
    if (selection.name === "__typename") continue;
    const field = type[selection.name];

    if (!field) throw new GraphQLError(`Field '${selection.name}' doesn't exist on type '${typeName}'`, "undefinedField", { typeName, fieldName: selection.name });
    if (field.deprecated) throw new GraphQLError(`Field '${selection.name}' on '${typeName}' is deprecated (${field.deprecated}). This fake refuses deprecated fields.`, "deprecatedField");
    for (const arg of Object.keys(selection.args)) {
      if (!(field.args ?? []).includes(arg)) throw new GraphQLError(`Field '${selection.name}' doesn't accept argument '${arg}'`, "argumentNotAccepted");
    }
    field.check?.(selection, context);
    const target = field.type.replace(/[[\]!]/g, "");
    const scalar = !schema[target];

    if (scalar && selection.selections) throw new GraphQLError(`Selections can't be made on scalars (field '${selection.name}' returns ${target})`);
    if (!scalar && !selection.selections) throw new GraphQLError(`Field must have selections (field '${selection.name}' returns ${target} but has no selections)`);
    const first = resolveValue(selection.args.first ?? { literal: 1 }, context.variables);
    const child = scalar ? 0 : validate(schema, target, selection.selections, context, [...path, selection.alias]);

    cost += 1 + (target.endsWith("Connection") ? Math.max(1, Number(first) || 1) * child : child);
  }
  return cost;
}

function encodeCursor(index) {
  return Buffer.from(`cursor:${index}`).toString("base64");
}

function decodeCursor(cursor) {
  const text = Buffer.from(String(cursor), "base64").toString("utf8");

  return /^cursor:\d+$/.test(text) ? Number(text.slice(7)) : -1;
}

/** An array as a Relay connection, paged by first/after. */
export function connection(items, args, extra = {}) {
  const first = Math.min(Number(args.first ?? items.length) || 0, 250);
  const start = args.after ? decodeCursor(args.after) + 1 : 0;
  const page = items.slice(start, start + first);

  return {
    __typename: "Connection",
    edges: page.map((node, offset) => ({ node, cursor: encodeCursor(start + offset) })),
    nodes: page,
    pageInfo: {
      hasNextPage: start + first < items.length,
      hasPreviousPage: start > 0,
      startCursor: page.length ? encodeCursor(start) : null,
      endCursor: page.length ? encodeCursor(start + page.length - 1) : null,
    },
    ...extra,
  };
}

async function execute(schema, typeName, value, list, context) {
  if (value === null || value === undefined) return null;
  const out = {};

  for (const selection of list) {
    if (selection.kind === "inline") {
      if (value.__typename === selection.type) Object.assign(out, await execute(schema, selection.type, value, selection.selections, context));
      continue;
    }
    if (selection.name === "__typename") {
      out[selection.alias] = value.__typename ?? typeName;
      continue;
    }
    const field = schema[typeName][selection.name];
    const args = Object.fromEntries(Object.entries(selection.args).map(([key, node]) => [key, resolveValue(node, context.variables)]));
    let raw = value[selection.name];

    if (typeof raw === "function") raw = await raw(args, context);
    const target = field.type.replace(/[[\]!]/g, "");

    if (target.endsWith("Connection") && Array.isArray(raw)) raw = connection(raw, args);
    if (!schema[target]) {
      out[selection.alias] = raw === undefined ? null : raw;
      continue;
    }
    if (Array.isArray(raw)) {
      out[selection.alias] = await Promise.all(raw.map((item) => execute(schema, item?.__typename && schema[item.__typename] ? item.__typename : target, item, selection.selections, context)));
    } else {
      const concrete = raw?.__typename && schema[raw.__typename] ? raw.__typename : target;

      out[selection.alias] = await execute(schema, concrete, raw, selection.selections, context);
    }
  }
  return out;
}

/**
 * Runs one request body ({ query, variables }) against a schema and a root
 * object. Returns { data } or { errors }, the shape GraphQL services send.
 */
export async function run(schema, roots, body, context) {
  if (!body || typeof body.query !== "string") return { errors: [{ message: "No query string was present", extensions: { code: "BAD_REQUEST" } }] };
  const variables = body.variables && typeof body.variables === "object" ? body.variables : {};
  let document;

  try {
    document = parse(body.query);
    checkVariables(document, variables);
  } catch (error) {
    return { errors: [{ message: error.message, extensions: { code: error.code ?? "PARSE_ERROR" } }] };
  }
  const rootType = document.operation === "mutation" ? "Mutation" : "QueryRoot";
  const ctx = { ...context, variables, operation: document.operation, operationName: document.name };
  let cost;

  try {
    cost = validate(schema, rootType, document.selections, ctx, []);
  } catch (error) {
    return { errors: [{ message: error.message, extensions: { code: error.code ?? "GRAPHQL_VALIDATION_FAILED", ...error.extra } }] };
  }
  const limited = context.beforeExecute?.(cost, ctx);

  if (limited) return limited;
  try {
    const data = await execute(schema, rootType, roots[rootType], document.selections, ctx);

    return { data, cost };
  } catch (error) {
    if (error instanceof GraphQLError) return { errors: [{ message: error.message, extensions: { code: error.code, ...error.extra } }] };
    throw error;
  }
}
