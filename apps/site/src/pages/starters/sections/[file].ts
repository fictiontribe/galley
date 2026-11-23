// Serves the section pictures the pages show, from the starter's own library
// (starters/<name>/galley/sections/<type>.webp), copied into the build.
import type { APIRoute } from "astro";
import { readFileSync } from "node:fs";
import { usedSectionThumbs } from "../../../lib/starters";

export async function getStaticPaths() {
  return (await usedSectionThumbs()).map((t) => ({ params: { file: t.src.split("/").pop() }, props: { path: t.file } }));
}

export const GET: APIRoute = ({ props }) => new Response(readFileSync(props.path as string), { headers: { "Content-Type": "image/webp" } });
