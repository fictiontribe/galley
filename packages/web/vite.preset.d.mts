/** Where each alias the app's source is written with leads. */
export declare const galleyWebAliases: Readonly<{ "@": string; "@brand": string }>;
/** The app's public folder (`theme.js`). */
export declare const galleyWebPublicDir: string;
/** What the app's source is written for. */
export declare const galleyWebTarget: string;
/** Packages there must be one copy of in the page. */
export declare const galleyWebDedupe: readonly string[];

/**
 * The Vite plugin: the two aliases, one copy of React and the router, and,
 * unless the program's config names its own, the app's public folder and
 * build target. Typed by its shape, not by this package's copy of Vite, so
 * it fits whichever Vite the program has.
 */
export declare function galleyWeb(): {
  name: string;
  config(user?: { publicDir?: string | false; build?: { target?: unknown } }): {
    resolve: { alias: Record<string, string>; dedupe: string[] };
    publicDir?: string;
    build?: { target: string };
  };
};
