// Serves each starter look's preview picture from the starter's own folder
// (starters/<name>/galley/previews/<look>.webp), copied into the build.
import type { APIRoute } from "astro";
import { readFileSync } from "node:fs";
import { usedStarters } from "../../../lib/starters";

export async function getStaticPaths() {
  return (await usedStarters()).flatMap((s) => s.looks.map((look) => ({ params: { file: `${s.id}-${look.id}.webp` }, props: { path: look.file } })));
}

export const GET: APIRoute = ({ props }) => new Response(readFileSync(props.path as string), { headers: { "Content-Type": "image/webp" } });
