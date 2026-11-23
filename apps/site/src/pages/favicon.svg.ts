// The favicon is the brand's own file (it switches to the reverse colours in
// dark browser chrome), served from brand/logo so it never drifts.
import type { APIRoute } from "astro";
import favicon from "../../../../brand/logo/favicon.svg?raw";

export const GET: APIRoute = () => new Response(favicon, { headers: { "Content-Type": "image/svg+xml" } });
