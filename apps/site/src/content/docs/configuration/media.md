---
title: Media
description: Where Galley saves new images, which folders the media library shows, how files on disk map to the paths written into content, and the upload rules.
group: configuration
order: 4
---

This page is for developers. Galley's media library is the image files in your repository — nothing is uploaded anywhere else. Two questions decide how it works: which folder new files are written to, and what URL that folder is served from, so the path written into content (`/images/hero.webp`) is the one the site can load. The code is [`workspace/media.ts`]({repository}/blob/main/packages/core/src/workspace/media.ts).

## The settings

| Key | Default | Meaning |
| --- | --- | --- |
| `media.dir` | the first of `images`, `img`, `assets/images`, `assets/img`, `assets`, `media`, `uploads` inside the public folder; else `<public>/images` | Where uploads and generated images are saved, relative to the site root. |
| `media.publicPath` | `media.dir` without its first segment: `public/images` → `/images` | The URL prefix that folder is served from. |
| `media.roots` | `media.dir`, and the whole public folder at `/` | Every folder the library lists, each `{ "dir", "publicPath" }`. `media.dir` is always included. |

The public folder is the framework's: `public/` for Astro (or `publicDir` from its config), `static/` for Docusaurus, Hugo and SvelteKit. For the starter, detection finds:

```json
{
  "dir": "public/images",
  "publicPath": "/images",
  "roots": [
    { "dir": "public/images", "publicPath": "/images" },
    { "dir": "public", "publicPath": "/" }
  ]
}
```

## Changing it

When images live somewhere detection doesn't look, or are served from a different prefix:

```json galley.config.json
{
  "media": {
    "dir": "public/uploads/2026",
    "publicPath": "/uploads/2026",
    "roots": [
      { "dir": "public/uploads", "publicPath": "/uploads" },
      { "dir": "src/assets", "publicPath": "/src/assets" }
    ]
  }
}
```

Setting `media.dir` also adds `<dir>/**` to the content-mode write surface, so editors can save there. Roots that detection found are writable in content mode for image, video and PDF files. Roots you add in `media.roots` are listed in the library but **not** added to the write surface — in the example above, `src/assets` can be browsed but nothing can be saved into it in content mode. Add a glob to `writable.content` if it should be ([Assistant instructions and build mode](/docs/configuration/assistant/#writable)).

## What the library holds

- **Types**: PNG, JPG, WebP, AVIF, GIF and SVG images (with their pixel size), PDFs and MP4 video. Anything else is refused: *That kind of file can't be added to the media library. …*
- **Uploads** are at most 25 MB. Raster images must actually parse as the type their name says: *That file doesn't look like a valid image.*
- **Names never overwrite.** The name is cleaned up (lowercase, hyphens), and a name already taken gets `-2`, `-3`… Uploads go only into a media folder: *Media can only be saved inside the site's media folders.*
- **Generated images** are held as candidates in a temporary folder until someone saves one; only then is it written to `media.dir`.

Like every other edit, a new image is an uncommitted file in the working tree until it is published, and it appears in the proof as a `media` change.

## Next

- [Assistant instructions and build mode](/docs/configuration/assistant/).
- [Connect the assistant](/docs/reference/assistant/#images) — the image providers.
