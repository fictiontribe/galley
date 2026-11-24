/** The sample site, snapshotted at build time by demo/build/plugin.ts. */
declare module "virtual:galley-demo/site" {
  /** Repository path → the file's text. */
  export const TEXT_FILES: Record<string, string>;
  /** Repository path → where the demo serves the file, and its size. */
  export const STATIC_FILES: Record<string, { url: string; size: number }>;
}
