import type { Plugin } from "vite";

/** Where each alias the app's source is written with leads. */
export declare const galleyWebAliases: Readonly<{ "@": string; "@brand": string }>;

/** A Vite plugin that sets the two aliases and nothing else. */
export declare function galleyWeb(): Plugin;
