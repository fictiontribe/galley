import { GalleyError } from "@galley/core";

export type ImportErrorReason = "blocked" | "not-wordpress" | "unreachable" | "auth" | "file" | "aborted" | "question" | "refused";

/**
 * An import problem the person can act on. It is a GalleyError, so the
 * server turns it into `{ error }` with a status like any engine error, and
 * `reason` lets the CLI and the app pick the next step to offer (for
 * "blocked": the export-file route).
 */
export class ImportError extends GalleyError {
  readonly reason: ImportErrorReason;

  constructor(reason: ImportErrorReason, message: string, detail?: string) {
    super(reason === "auth" ? "unauthorized" : reason === "file" || reason === "question" || reason === "refused" ? "invalid" : reason === "aborted" ? "busy" : "not-found", message, detail);
    this.name = "ImportError";
    this.reason = reason;
  }
}

export const EXPORT_FILE_ROUTE =
  "Export a file instead: in WordPress, open Tools › Export, choose “All content”, download the file, and import that.";
