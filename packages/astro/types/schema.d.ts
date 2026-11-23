import type { z } from "astro/zod";
import type { FormDefinition, ScriptsConfig } from "../src/kit";

/** A form file: src/content/forms/<id>.json. */
export declare const formSchema: z.ZodType<FormDefinition>;
/** The scripts setup: src/data/scripts.json. */
export declare const scriptsSchema: z.ZodType<ScriptsConfig>;
export declare const FIELD_TYPES: readonly FormDefinition["fields"][number]["type"][];
/** A zod error as plain lines: “scripts[0].settings.containerId: …”. */
export declare function describeIssues(error: z.ZodError): string[];
