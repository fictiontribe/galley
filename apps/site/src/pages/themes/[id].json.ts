// Each theme on /themes/ as a file to download: the same file the app exports
// (adjusted, with its $schema), named after the theme's id.
import type { APIRoute } from "astro";
import { siteThemes } from "../../lib/themes";

export function getStaticPaths() {
  return siteThemes.map((entry) => ({ params: { id: entry.theme.id }, props: { text: entry.text } }));
}

export const GET: APIRoute = ({ props }) => new Response(props.text as string, { headers: { "Content-Type": "application/json; charset=utf-8" } });
