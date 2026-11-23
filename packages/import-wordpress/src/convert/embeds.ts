/**
 * Video embeds. WordPress turns a bare YouTube or Vimeo link into a player
 * (oEmbed) when the page is shown; an export file only carries the link. The
 * player markup below is what those services publish for embedding, so the
 * imported page shows the same video.
 */

export interface Embed {
  html: string;
  provider: string;
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\.|^m\./, "");

  if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const match = /^\/(?:embed|shorts|live|v)\/([\w-]+)/.exec(url.pathname);

  return match?.[1] ?? null;
}

function vimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");

  if (host === "player.vimeo.com") return /^\/video\/(\d+)/.exec(url.pathname)?.[1] ?? null;
  if (host !== "vimeo.com") return null;
  return /^\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?(\d+)/.exec(url.pathname)?.[1] ?? null;
}

function startSeconds(url: URL): number | null {
  const raw = url.searchParams.get("t") ?? url.searchParams.get("start");

  if (!raw) return null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);

  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);

  return seconds > 0 ? seconds : null;
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The player for a video link, or null when the link isn't a known video service. */
export function videoEmbed(link: string, title?: string): Embed | null {
  let url: URL;

  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const youtube = youtubeId(url);

  if (youtube) {
    const start = startSeconds(url);
    const src = `https://www.youtube.com/embed/${encodeURIComponent(youtube)}${start ? `?start=${start}` : ""}`;

    return {
      provider: "YouTube",
      html: `<iframe width="560" height="315" src="${src}" title="${escapeAttribute(title || "YouTube video")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>`,
    };
  }
  const vimeo = vimeoId(url);

  if (vimeo) {
    return {
      provider: "Vimeo",
      html: `<iframe width="640" height="360" src="https://player.vimeo.com/video/${vimeo}" title="${escapeAttribute(title || "Vimeo video")}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`,
    };
  }
  return null;
}

/** Anything else WordPress would have embedded stays as a plain link, so nothing is lost. */
export function linkEmbed(link: string): Embed {
  let provider = "a link";

  try {
    provider = new URL(link).hostname.replace(/^www\./, "");
  } catch {
    // keep the generic name
  }
  return { provider, html: `<p><a href="${escapeAttribute(link.trim())}">${escapeHtml(link.trim())}</a></p>` };
}
