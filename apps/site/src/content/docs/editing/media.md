---
title: Add images and video
description: Upload pictures, videos and documents, make an image or a video from a description, and use them on a page.
group: editing
order: 5
---

For people who edit a site. **Media** holds every picture, video and document the site uses. A file you add is a change like any other: it goes live when you publish.

## Upload

1. Open **Media** in the sidebar.
2. Press **Upload**, drop files anywhere on the screen, or paste a picture. Each file can be up to 25 MB.
3. Choose a file to see its details: its address on the site, size, folder, and whether it is new or changed.

To use a picture on a page, choose it from the picture field in the [form](/docs/editing/form/), or click the picture on the page with [Click to edit](/docs/editing/on-the-page/).

## Make an image from a description

1. In **Media**, press **Generate an image**.
2. **Describe the image** — what's in it, the mood, the setting. **Style** is optional. Choose a **Shape** and **How many**.
3. Press **Make images**. Choose the one you like (**Make new ones** tries again), give it a name under **Name it**, then **Save to media**.

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/media-generate@1x.webp" srcset="/docs/media-generate@1x.webp 1x, /docs/media-generate.webp 2x" alt="The Generate an image window with a description of a wool coat on an iron hook against a lime-washed wall, a note that it's made to the site's brand, Built-in placeholders as the provider, two candidate pictures, the name wool-coat-on-an-iron-hook, and Discard all and Save to media." width="960" height="701" loading="lazy" decoding="async"></figure>

Without an image service, the **Provider** is **Built-in placeholders**: plain artwork labelled with your description, made on this computer, so you can try a layout before the real picture exists. Real images need a service chosen in **App settings › Images** — OpenAI, Google (Nano Banana) or OpenRouter — each with its own key and its own charges. What you type, and any reference pictures, are sent to that service.

## Make a video

**Generate a video** works the same way, through the OpenRouter plugin. It needs OpenRouter's key (in **Plugins**), and the window shows what the video will cost before anything starts; OpenRouter charges the key's account. The docs haven't run video generation against the real service.

## If something's different

- **"That file is larger than 25 MB."** Make it smaller and upload again.
- **The window says the images will be placeholders.** No image service is chosen; ask whoever looks after the app to choose one in **App settings › Images**.
- **A picture shows on the page but not in Media.** It may come from the site's design rather than its media folder; change it in the form, or ask the site's developer.
