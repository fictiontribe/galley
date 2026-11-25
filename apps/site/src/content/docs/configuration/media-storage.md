---
title: Media in a bucket
description: Keep a site's pictures, PDFs and videos in a Cloudflare R2 or Amazon S3 bucket, and pictures in Cloudflare Images, instead of its repository — the steps on each side, what Galley checks, moving files there and back, and what it costs.
group: configuration
order: 4.5
---

This page is for whoever looks after a site. Out of the box, Galley keeps media in the site's repository, beside its pages ([Media](/docs/configuration/media/)). That is simplest, but every picture makes the repository bigger for good. A bucket keeps the files elsewhere and serves each one at its own address; Cloudflare Images does the same for pictures and also resizes them and sends each browser WebP or AVIF. Either way pages store the full address, so the site needs no build step to find them.

Cloudflare R2 has been run end to end on the real service by the people who built it (2026-11-25). Amazon S3, other S3-compatible stores and Cloudflare Images have not yet: they are checked against stand-ins that answer the way those services do.

## What changes

- **New uploads go to the bucket** — pictures, PDFs and videos alike, under names that never replace a file already there. Files already in the repository stay where they are until you move them.
- **They are public at once.** A file in the bucket can be loaded by anyone with its address from the moment it is uploaded, before you publish. Keep private documents out of it.
- **Proof lists them** under *In the bucket* until a published page uses them. Discarding a page doesn't remove its uploads; Galley offers to remove the ones nothing uses any more.
- **SVG pictures are stored as downloads.** In a page they show as usual; opened on their own at the bucket's address, the browser saves them instead of showing them. An SVG can carry script, and this keeps it from running on the media address.
- **Deleting is for good.** Galley deletes a file from the bucket only when no page uses it — not the pages waiting in Proof, not the published version — and on a hosted editor only people who can publish may.

## Choose where

| | Cloudflare R2 | Amazon S3 | Cloudflare Images |
| --- | --- | --- | --- |
| Takes | Any file: pictures, PDFs, video | Any file | Pictures only (PNG, JPEG, GIF, WebP, SVG), up to 10 MB |
| Best for | Most sites | Sites already on AWS | Sites that want pictures resized and sent as WebP or AVIF for them |
| Charges | What you store; nothing for visitors loading it; a free monthly allowance | What you store and what visitors download | Per picture stored and per picture delivered; needs the Images Paid plan |
| Public address | A custom domain on Cloudflare (or r2.dev, for trying out) | The bucket's own address, CloudFront, or your own | imagedelivery.net, or a domain of the same Cloudflare account |

One bucket at most, and Cloudflare Images at most, together or alone. With both, pictures go to Images and everything else to the bucket; with Images alone, everything else stays in the repository. An upload always says where it went.

**R2 or Images?** R2 for everything, video included, with no charge per picture or per visit. Images when you want resizing and modern formats handled: it charges $5 per 100,000 pictures stored a month and $1 per 100,000 delivered (Cloudflare's prices on 24 November 2026). A site with 2,000 pictures and 300,000 picture views a month would pay about $0.10 + $3 a month in Images; in R2 the same pictures cost only their storage. Prices change: see [R2's](https://developers.cloudflare.com/r2/pricing/), [S3's](https://aws.amazon.com/s3/pricing/) and [Images'](https://developers.cloudflare.com/images/pricing/).

## Cloudflare R2, step by step

1. In the Cloudflare dashboard, open **Storage & databases › R2 › Overview** (finish Cloudflare's checkout if it asks; R2 has a free allowance). Select **Create bucket** and name it with lowercase letters, digits and dashes.
2. Open the bucket, select **Settings**, and under **Custom Domains** select **Add**. Type an address on a domain already in this Cloudflare account (`media.example.com`), **Continue**, then **Connect Domain**. It turns from *Initializing* to *Active* within minutes. Only trying it out? Under **Public Development URL**, **Enable** gives an r2.dev address — rate-limited, for development only.
3. Back on **R2 › Overview**, under **Account Details**, select **Manage** next to **API Tokens**, then **Create Account API token**. Choose **Object Read & Write** and limit it to this bucket. Copy the **Access Key ID** and **Secret Access Key** (the secret is shown once). The **Account ID** is on the same page.
4. In Galley, open **Media**, select **Keep media outside the repository**, choose **Cloudflare R2**, and paste the account ID, bucket name, public address and the key.

A bucket made in a jurisdiction (such as the EU) is reached at its own S3 address: paste it under *S3 address of a jurisdiction bucket*.

**Make the bucket for me.** When the site already has a Cloudflare key for putting it online, Galley can do steps 1 and 2 with it: choose **Cloudflare R2**, then **Make the bucket for me**, with the account ID and a name. It makes the bucket and turns on its r2.dev address, and fills in the fields; you still make the key for its files (step 3), because a key for putting a site online shouldn't be able to make other keys. The site's key needs **Account › Workers R2 Storage › Edit** for this; Galley says so if it hasn't. From a terminal: `galley media connect --connector r2 --make-bucket`. Galley can later remove that bucket — only that one, and only once nothing uses it and it is empty.

Another store that speaks the S3 API — Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO — works the same way: choose **Another S3-compatible store** and give its S3 address and region name as the store shows them. Galley addresses the bucket in the path (`address/bucket/file`), which these stores accept.

## Amazon S3, step by step

1. In the S3 console, **Create bucket**: pick its Region and a name without dots (a name with dots can't be reached over https at the bucket's own address). Leave **Object Ownership** at *Bucket owner enforced*.
2. Unless CloudFront serves the bucket, let visitors read the files: on the bucket's **Permissions** tab, under **Block public access (bucket settings)**, **Edit**, clear **Block all public access**, and **Save changes**. Then under **Bucket policy**, **Edit** and paste the policy Galley shows — it lets anyone read files in the site's folder, nothing else.
3. In IAM, **Users › Create user**, named after the site, with no console access and no permissions yet. On its **Permissions** tab, **Add permissions › Create inline policy**, choose **JSON** and paste the key's policy Galley shows.
4. On the user's **Security credentials** tab, **Create access key**, choose **Other**, and copy both values (the secret is shown once).
5. In Galley, choose **Amazon S3** and paste the bucket, its Region code (`eu-west-1`), the public address and the key.

The key's policy lets it list, add, read and delete files **in the site's folder** of that one bucket. Even listing carries the folder as a condition, which is why Galley's first check lists that folder rather than asking about the whole bucket.

## Cloudflare Images, step by step

1. In the Cloudflare dashboard, open **Images › Hosted Images**. Keeping pictures there needs the **Images Paid plan**; take it if Cloudflare offers it.
2. On the Hosted Images page, under **Developer Resources**, copy the **account hash** — the part after `imagedelivery.net/` in the example address. The **account ID** is in the dashboard's address, right after `dash.cloudflare.com/`.
3. Open **My Profile › API Tokens**, **Create Token**, then **Get started** next to **Create Custom Token**. Under **Permissions** choose **Account › Cloudflare Images › Edit**; under **Account Resources**, **Include** this account. **Continue to summary**, **Create Token**, and copy it (it is shown once). If the site already has a Cloudflare key for putting it online, you can add **Account › Cloudflare Images › Edit** to that token instead.
4. In Galley, open **Media**, select **Keep media outside the repository** (or **Storage settings**), choose **Cloudflare Images**, and paste the account ID, the account hash and the token — or tick **Use the site's Cloudflare key**.

Optional: a **variant** other than `public` (one you made on the **Delivery** tab), and a domain to **deliver from** — a domain proxied by Cloudflare in the same account, whose `/cdn-cgi/imagedelivery/` path then serves the pictures. Pages store each picture's address with the variant (`https://imagedelivery.net/<hash>/<id>/public`). Cloudflare names each picture; its own name stays in Galley's library.

If something is wrong, the check says what: a token without **Cloudflare Images › Edit** (or the site's Cloudflare key without it, and how to add it), an account ID Cloudflare doesn't know, storage not turned on (the Paid plan), an account hash or variant that doesn't deliver.

## Before you share a bucket or set keys for everyone

- **Several sites in one bucket need a folder each.** An empty *Folder in the bucket* means the whole bucket: give every site its own folder, so none can see or remove another's files.
- **Keys given by environment variable** (`GALLEY_MEDIA_ACCESS_KEY_ID`, `GALLEY_MEDIA_SECRET_ACCESS_KEY`, `GALLEY_MEDIA_IMAGES_TOKEN`) are used for whatever bucket and address an owner of the editor types in. Set them only on an install whose owners you trust with that key.
- **A CDN in front of the bucket** may drop the header that makes an SVG download instead of opening; check it keeps `Content-Disposition`.
- **Cloudflare Images connected before pictures were marked as each site's** shows only the pictures Galley already knows, and Storage settings says so: connect it again to mark new pictures and list them.

## What Galley checks

Before it saves anything, Galley does everything the site will need, for real, with a tiny test picture: it reaches the bucket, stores the picture under a new name, reads it back, lists the site's files, loads it from the public address with no key, and removes it. It stops at the first step that fails and says what to change, with the cursor in that field — a key the service doesn't know, a secret that doesn't go with it, a bucket name that doesn't exist, the wrong Region, a key that can read but not write, an address that turns visitors away. A key that fails never replaces one that works.

The key is kept on the computer (or the hosted editor) that runs Galley, never in the site's files; afterwards only its last four characters are shown.

## Move files there and back

In **Media › Storage settings**, **Move files** shows what will happen before anything does: how many files, how many places in how many pages and page templates, how many of the repository's copies are removed and how many stay, with what still uses them. The plan takes the move's own steps without changing anything, so the result says the same. Moving to Cloudflare Images moves pictures only: PDFs, videos and anything over its limits stay where they are, and the plan says how many.

- **To the bucket**: files are copied, pages are changed to the full addresses, and then the repository's copies are removed (they leave the site when you publish) — unless you keep them.
- **Back to the repository**: files come back to the media folder and pages use the site's own addresses again. The bucket keeps its copies until you remove them.
- **A new public address** (a custom domain instead of r2.dev): Galley first checks the new address serves the bucket's files, then changes every page.

Each is safe to run again: what is already there is skipped, and a different file under the same name is reported, never replaced. The page changes wait in Proof like any other.

### What stays in the repository, and why

A copy stays only while something the site is built from, and that the move can't update, still uses it. The plan sorts every file that names a picture:

- **Pages and other content** are updated.
- **Galley's own page templates** (the files the site's settings list under `templates`) are updated too, so a page made from one later doesn't carry an address that is gone. A template is not content, so this is a build-mode change: it is made when the site allows build mode and your account may use it, and it waits in Proof like the rest. Where build mode is off, templates are left and keep the files they use.
- **The site's code, and data it is built from that content mode doesn't write** are never changed by a move, so the files they use stay: the favicon and the share picture a layout names, say, or the pictures in a catalogue file. The plan names them. To move those too, put the new addresses there by hand or in build mode, then run the move again.
- **Anything else** keeps nothing: a README, a record kept beside the site, a script outside its source. The built site doesn't read them. The plan lists them on a line of their own, "Also mentioned in …. Nothing the site is built from reads them, as far as Galley can follow, so they aren't changed and keep no copy", and they are left as they are.

What a site is built from comes from its framework: for Astro, the source folder, the public folder and the configuration at the root.

A file outside those counts too when a file inside reads it. A page that imports `../../data/team.json` is built from that file, so the pictures it names stay, and the plan says why: "still used by data/team.json (read by src/lib/team.ts)". Galley finds this by the path written in the file that does the reading (an import, a file the code opens, a glob), one step from the site's own folders.

It can't see everything a build reads. Not followed: an alias (`@/data/…`, a path set in `tsconfig.json`), a path that starts at the site's root or is put together while the site builds, and a file reached through a second file outside those folders. When your site's build reads something that way, name it in `galley.config.json` and it counts too:

```json
{ "build": { "sources": ["data/**"] } }
```

So read the "Also mentioned in" line before you move. If the build reads one of the files it lists, add that file to `build.sources` first and open the plan again.

Nothing is removed that a file counted this way still uses. A copy that is removed is an ordinary deletion waiting in Proof, where it can be put back; and the bucket has the file. A file that was never published has no deletion to put back, because removing it only takes back an addition: it is in the bucket, Proof lists it among the uploads, and moving back to the repository brings it back.

While a move runs, the Media screen shows how far it is. When it ends, it says there how many files were copied, how many pages and page templates changed, and how many files stayed in the repository and what still uses them. That stays on the Media screen until you dismiss it or move files again. A file that stays because the site's code uses it is the move working as meant; only what couldn't be copied, updated or removed is listed as a problem.

## From a terminal

```sh
galley media connect --connector r2 --bucket lowfield-media --account <account-id> --public-url https://media.example.com
```

The key is read from `GALLEY_MEDIA_ACCESS_KEY_ID` and `GALLEY_MEDIA_SECRET_ACCESS_KEY`, or asked for with nothing shown; it is never an option. Then:

```sh
galley media move --to bucket
```

For Cloudflare Images, the token is read from `GALLEY_MEDIA_IMAGES_TOKEN`, or asked for:

```sh
galley media connect --connector cloudflare-images --account <account-id> --account-hash <hash>
```

`galley media move --to images` moves the pictures. `galley media check` runs the checks again; `galley media disconnect` stops using the bucket (`--images`: Cloudflare Images); what is already there stays. The [command-line reference](/docs/reference/cli/) has every option.

## Next

- [Media](/docs/configuration/media/): the media folders, names and limits.
- [Add images and video](/docs/editing/media/): uploading, for people who edit.
