import { parseArgs, type ParseArgsConfig } from "node:util";
import { PRODUCT } from "@galley/core/brand";

/** A mistake in how a command was typed. Exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

type Options = NonNullable<ParseArgsConfig["options"]>;

export const HELP_OPTION = { help: { type: "boolean", short: "h" } } as const satisfies Options;

/** parseArgs with plain-language errors. */
export function parse<T extends Options>(command: string, argv: string[], options: T, maxPositionals = 1) {
  let parsed;

  try {
    parsed = parseArgs({ args: argv, options: { ...HELP_OPTION, ...options }, allowPositionals: true, strict: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /Unknown option '([^']+)'/.exec(message)?.[1];
    const hint = `Run \`${PRODUCT.slug}${command ? ` ${command}` : ""} --help\` to see the options.`;

    if (unknown) throw new UsageError(`${unknown} isn't an option here. ${hint}`);
    const missing = /Option '([^']+)' argument missing/.exec(message)?.[1];

    if (missing) throw new UsageError(`${missing.split(",").pop()!.trim().split(" ")[0]} needs a value. ${hint}`);
    throw new UsageError(`${message} ${hint}`);
  }
  if (parsed.positionals.length > maxPositionals) {
    throw new UsageError(`Too many arguments: ${parsed.positionals.slice(maxPositionals).join(" ")}. Run \`${PRODUCT.slug}${command ? ` ${command}` : ""} --help\`.`);
  }
  return parsed;
}

export function portOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`--port must be a number between 1 and 65535, not “${value}”.`);
  return port;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
