// /agent.md — the brief an AI coding agent reads before installing or
// operating Galley. Its text is src/content/pages/agent.md.
import type { APIRoute } from "astro";
import { getPage } from "../lib/pages";
import { fill } from "../lib/site";

export const GET: APIRoute = async () => {
  const { body } = await getPage("agent");
  return new Response(fill(body).trim() + "\n", { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
