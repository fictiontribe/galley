/**
 * Recovering field definitions from a zod schema expression, statically.
 * Only what is plainly readable is claimed; anything else becomes a `json`
 * field that corpus inference may refine later.
 */
import type { BlockType, Field, JsonValue } from "../../types";
import { labelForBlockType, labelForKey } from "../util/text";
import { calleeName, resolve, stringOf, type Expr } from "./js/parse";

interface Chain {
  /** Base constructor: "string", "coerce.date", "image", "reference", or "" when unknown. */
  base: string;
  baseArgs: Expr[];
  methods: Array<{ name: string; args: Expr[] }>;
}

/** Names the zod namespace may be imported under. */
const ZOD_ROOTS = new Set(["z", "zod", "Z"]);
const HELPERS = new Set(["image", "reference"]);

type Scope = Map<string, Expr>;

function literal(expr: Expr | undefined): JsonValue | undefined {
  if (!expr) return undefined;
  switch (expr.kind) {
    case "string":
      return expr.value;
    case "number":
      return expr.value;
    case "bool":
      return expr.value;
    case "null":
      return null;
    case "array": {
      const items = expr.items.map(literal);

      return items.every((item) => item !== undefined) ? (items as JsonValue[]) : undefined;
    }
    case "object": {
      const out: { [key: string]: JsonValue } = {};

      for (const prop of expr.props) {
        if (!("key" in prop)) return undefined;
        const value = literal(prop.value);

        if (value === undefined) return undefined;
        out[prop.key] = value;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** Splits `z.string().min(1).optional()` into its base and the methods applied to it. */
function unchain(input: Expr, scope: Scope, depth = 0): Chain | null {
  const methods: Chain["methods"] = [];
  let expr = resolve(input, scope);

  for (let guard = 0; guard < 100; guard += 1) {
    if (expr.kind !== "call") {
      if (expr.kind === "ident" && depth < 8) {
        const bound = scope.get(expr.name);

        if (bound) {
          const inner = unchain(bound, scope, depth + 1);

          return inner ? { ...inner, methods: [...inner.methods, ...methods] } : null;
        }
      }
      return null;
    }
    const callee = expr.callee;
    const name = calleeName(callee);

    if (name !== null) {
      const parts = name.split(".");
      const root = parts[0]!;

      if (ZOD_ROOTS.has(root) && parts.length >= 2) {
        const base = parts.slice(1).join(".");

        // Wrappers whose meaning is the schema inside them.
        if (base === "preprocess" && expr.args[1] && depth < 8) {
          const inner = unchain(expr.args[1], scope, depth + 1);

          return inner ? { ...inner, methods: [...inner.methods, ...methods] } : null;
        }
        if (base === "lazy" && expr.args[0]?.kind === "arrow" && depth < 8) {
          const inner = unchain(expr.args[0].body, scope, depth + 1);

          return inner ? { ...inner, methods: [...inner.methods, ...methods] } : null;
        }
        return { base, baseArgs: expr.args, methods };
      }
      if (parts.length === 1 && HELPERS.has(root)) return { base: root, baseArgs: expr.args, methods };
    }
    if (callee.kind === "member") {
      methods.unshift({ name: callee.property, args: expr.args });
      expr = resolve(callee.object, scope);
      continue;
    }
    if (callee.kind === "ident" && depth < 8) {
      // A helper defined in the file, e.g. `const seo = () => z.object(…)`.
      const bound = scope.get(callee.name);

      if (bound && bound.kind === "arrow") {
        const bindings = new Map(bound.params.map((param, index) => [param, expr.kind === "call" ? expr.args[index] : undefined] as const));
        const inner = unchain(substitute(bound.body, bindings), scope, depth + 1);

        return inner ? { ...inner, methods: [...inner.methods, ...methods] } : null;
      }
    }
    return null;
  }
  return null;
}

/** Replaces a helper's parameters with the arguments it was called with. */
function substitute(expr: Expr, bindings: Map<string, Expr | undefined>): Expr {
  switch (expr.kind) {
    case "ident":
      return bindings.get(expr.name) ?? expr;
    case "member":
      return { ...expr, object: substitute(expr.object, bindings) };
    case "call":
    case "new":
      return { ...expr, callee: substitute(expr.callee, bindings), args: expr.args.map((arg) => substitute(arg, bindings)) };
    case "array":
      return { ...expr, items: expr.items.map((item) => substitute(item, bindings)) };
    case "object":
      return { ...expr, props: expr.props.map((prop) => ("key" in prop ? { key: prop.key, value: substitute(prop.value, bindings) } : { spread: substitute(prop.spread, bindings) })) };
    default:
      return expr;
  }
}

function field(key: string, partial: Partial<Field>): Field {
  return { key, label: labelForKey(key), type: "json", required: true, source: "schema", ...partial };
}

/** Fields of a `z.object({...})` (with `.extend`, `.merge`, `.partial`, `.omit`, `.pick`), or null. */
export function objectFields(input: Expr, scope: Scope, depth = 0): Field[] | null {
  const chain = unchain(input, scope);

  if (!chain || depth > 8) return null;
  let fields: Field[] | null = null;

  if (chain.base === "object" || chain.base === "strictObject" || chain.base === "looseObject") {
    fields = shapeFields(resolve(chain.baseArgs[0] ?? { kind: "unknown" }, scope), scope, depth);
  } else if (chain.base === "intersection" && chain.baseArgs.length === 2) {
    const left = objectFields(chain.baseArgs[0]!, scope, depth + 1);
    const right = objectFields(chain.baseArgs[1]!, scope, depth + 1);

    fields = left && right ? [...left.filter((item) => !right.some((other) => other.key === item.key)), ...right] : null;
  }
  if (!fields) return null;
  for (const method of chain.methods) {
    if (method.name === "extend" && method.args[0]) {
      const extra = shapeFields(resolve(method.args[0], scope), scope, depth) ?? [];

      fields = [...fields.filter((item) => !extra.some((other) => other.key === item.key)), ...extra];
    } else if (method.name === "merge" && method.args[0]) {
      const extra = objectFields(method.args[0], scope, depth + 1) ?? [];

      fields = [...fields.filter((item) => !extra.some((other) => other.key === item.key)), ...extra];
    } else if (method.name === "partial") {
      fields = fields.map((item) => ({ ...item, required: false }));
    } else if ((method.name === "omit" || method.name === "pick") && method.args[0]?.kind === "object") {
      const keys = new Set(method.args[0].props.flatMap((prop) => ("key" in prop ? [prop.key] : [])));

      fields = fields.filter((item) => (method.name === "omit" ? !keys.has(item.key) : keys.has(item.key)));
    }
  }
  return fields;
}

function shapeFields(shape: Expr, scope: Scope, depth: number): Field[] | null {
  if (shape.kind !== "object") return null;
  const fields: Field[] = [];

  for (const prop of shape.props) {
    if ("spread" in prop) {
      // `...base.shape` or `...baseShape`
      const spread = resolve(prop.spread, scope);
      const inner = spread.kind === "member" && spread.property === "shape" ? objectFields(spread.object, scope, depth + 1) : shapeFields(spread, scope, depth + 1);

      for (const item of inner ?? []) {
        const at = fields.findIndex((existing) => existing.key === item.key);

        if (at === -1) fields.push(item);
        else fields[at] = item;
      }
      continue;
    }
    const parsed = fieldFromZod(prop.key, prop.value, scope, depth + 1);
    const at = fields.findIndex((existing) => existing.key === prop.key);

    if (at === -1) fields.push(parsed);
    else fields[at] = parsed;
  }
  return fields;
}

/**
 * The members of a union, with nested unions flattened: the starter's
 * `z.union([section, unknownSection])`, where `section` is itself a
 * `z.discriminatedUnion("type", […])`, reads as one list of members.
 */
function unionMembers(chain: Chain, scope: Scope, depth: number): { discriminator: string | null; members: Expr[] } | null {
  let discriminator: string | null = null;
  let list: Expr;

  if (chain.base === "discriminatedUnion") {
    const first = resolve(chain.baseArgs[0] ?? { kind: "unknown" }, scope);

    // Newer zod lets the key be omitted: `z.discriminatedUnion([a, b])`.
    if (first.kind === "array") list = first;
    else {
      discriminator = stringOf(first);
      list = resolve(chain.baseArgs[1] ?? { kind: "unknown" }, scope);
    }
  } else if (chain.base === "union") {
    list = resolve(chain.baseArgs[0] ?? { kind: "unknown" }, scope);
  } else return null;
  if (list.kind !== "array") return null;
  const members: Expr[] = [];

  for (const item of list.items) {
    const inner = depth < 8 ? unchain(item, scope) : null;

    if (inner && (inner.base === "union" || inner.base === "discriminatedUnion")) {
      const nested = unionMembers(inner, scope, depth + 1);

      if (!nested) return null;
      if (nested.discriminator) {
        if (discriminator && discriminator !== nested.discriminator) return null;
        discriminator = nested.discriminator;
      }
      members.push(...nested.members);
    } else members.push(item);
  }
  return { discriminator, members };
}

const isTag = (field: Field | undefined): boolean => field !== undefined && field.type === "select" && (field.options?.length ?? 0) >= 1;

/**
 * Block types of a discriminated union (or a union of objects sharing a
 * literal key). A member whose key is a plain string rather than a literal is
 * a catch-all ("any other section type") — it names no block type of its
 * own, so it is left out instead of making the whole union unreadable.
 */
function unionBlocks(chain: Chain, scope: Scope, depth: number): { discriminator: string; blocks: BlockType[] } | null {
  const union = unionMembers(chain, scope, depth);

  if (!union || union.members.length === 0) return null;
  const objects = union.members.map((member) => objectFields(member, scope, depth + 1));

  if (objects.some((item) => item === null)) return null;
  const fieldsList = objects as Field[][];
  let discriminator = union.discriminator;

  if (!discriminator) {
    // A plain union counts as blocks only when every member carries the same
    // key and the members that name a type pin it to a literal.
    const first = fieldsList.find((fields) => fields.some(isTag));

    discriminator =
      first?.find((candidate) => isTag(candidate) && fieldsList.every((fields) => fields.some((item) => item.key === candidate.key && (isTag(item) || item.type === "string"))))?.key ?? null;
    if (!discriminator) return null;
  }
  const blocks: BlockType[] = [];

  for (const fields of fieldsList) {
    const tag = fields.find((item) => item.key === discriminator);

    if (!tag || !isTag(tag)) continue;
    for (const type of tag.options ?? []) {
      if (blocks.some((block) => block.type === type)) continue;
      blocks.push({ type, label: labelForBlockType(type), fields: fields.filter((item) => item.key !== discriminator), count: 0 });
    }
  }
  return blocks.length > 0 ? { discriminator, blocks } : null;
}

/** One field from a zod expression. Unknown shapes come back as `json`. */
export function fieldFromZod(key: string, input: Expr, scope: Scope, depth = 0): Field {
  const chain = depth > 12 ? null : unchain(input, scope);

  if (!chain) {
    const nested = depth > 12 ? null : objectFields(input, scope, depth + 1);

    return nested ? field(key, { type: "object", fields: nested }) : field(key, {});
  }
  let base: Partial<Field> = {};
  const arg0 = chain.baseArgs[0];

  switch (chain.base) {
    case "string":
    case "coerce.string":
      base = { type: "string" };
      break;
    case "number":
    case "coerce.number":
    case "bigint":
    case "coerce.bigint":
    case "int":
      base = { type: "number" };
      break;
    case "boolean":
    case "coerce.boolean":
      base = { type: "boolean" };
      break;
    case "date":
    case "coerce.date":
      base = { type: "date" };
      break;
    case "enum": {
      const values = literal(arg0 ? resolve(arg0, scope) : undefined);

      base = Array.isArray(values) && values.every((value) => typeof value === "string") ? { type: "select", options: values as string[] } : { type: "string" };
      break;
    }
    case "literal": {
      const value = literal(arg0);

      base = typeof value === "string" ? { type: "select", options: [value] } : typeof value === "boolean" ? { type: "boolean" } : typeof value === "number" ? { type: "number" } : {};
      break;
    }
    case "union": {
      const list = arg0 ? resolve(arg0, scope) : undefined;
      const options = list?.kind === "array" ? list.items.map((item) => unchain(item, scope)) : [];

      if (options.length > 0 && options.every((option) => option?.base === "literal" && typeof literal(option.baseArgs[0]) === "string")) {
        base = { type: "select", options: options.map((option) => literal(option!.baseArgs[0]) as string) };
      }
      break;
    }
    case "image":
      base = { type: "image" };
      break;
    case "reference": {
      const collection = stringOf(arg0);

      base = collection ? { type: "reference", collection } : { type: "reference" };
      break;
    }
    case "array": {
      const element = arg0 ? fieldFromZod("item", arg0, scope, depth + 1) : field("item", {});
      const elementChain = arg0 ? unchain(arg0, scope) : null;
      const union = elementChain ? unionBlocks(elementChain, scope, depth) : null;

      if (union) base = { type: "blocks", discriminator: union.discriminator, blocks: union.blocks };
      else if (element.type === "string") base = { type: "tags" };
      else base = { type: "list", of: { ...element, label: "Item", required: true } };
      break;
    }
    case "object":
    case "strictObject":
    case "looseObject": {
      const nested = objectFields(input, scope, depth + 1);

      base = nested ? { type: "object", fields: nested } : {};
      break;
    }
    case "optional":
    case "nullable":
    case "nullish":
      return { ...fieldFromZod(key, arg0 ?? { kind: "unknown" }, scope, depth + 1), required: false };
    default:
      base = {};
  }
  let result = field(key, base);

  for (const method of chain.methods) {
    switch (method.name) {
      case "optional":
      case "nullish":
      case "nullable":
      case "catch":
        result.required = false;
        break;
      case "default": {
        result.required = false;
        const value = literal(method.args[0]);

        if (value !== undefined) result.default = value;
        break;
      }
      case "describe": {
        const text = stringOf(method.args[0]);

        if (text) result.description = text;
        break;
      }
      case "url":
        if (result.type === "string") result.type = "url";
        break;
      case "datetime":
        if (result.type === "string") result.type = "datetime";
        break;
      case "date":
        if (result.type === "string") result.type = "date";
        break;
      case "array":
        result = field(key, result.type === "string" ? { type: "tags" } : { type: "list", of: { ...result, key: "item", label: "Item", required: true } });
        break;
      case "extend":
      case "merge":
      case "partial":
      case "omit":
      case "pick": {
        const nested = objectFields(input, scope, depth + 1);

        if (nested) result = { ...result, type: "object", fields: nested };
        break;
      }
      default:
        break;
    }
  }
  return result;
}
