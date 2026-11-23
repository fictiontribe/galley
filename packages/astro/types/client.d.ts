export type { Submitter, SubmitContext, SubmitResult } from "../src/client/types";
import type { Submitter } from "../src/client/types";

/** Adds (or replaces) the submitter for a destination's `provider`. */
export declare function registerFormProvider(id: string, submitter: Submitter): void;
/** Starts every form under `root` that isn't running yet. */
export declare function initForms(root?: ParentNode): void;
export declare const KIT_VERSION: string;
