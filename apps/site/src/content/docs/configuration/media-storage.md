---
title: Media in a bucket
description: Keep a site's pictures, PDFs and videos in a Cloudflare R2 or Amazon S3 bucket instead of its repository — the steps on each side, what Galley checks, moving files there and back, and what it costs.
group: configuration
order: 4.5
---

This page is for whoever looks after a site. Out of the box, Galley keeps media in the site's repository, beside its pages ([Media](/docs/configuration/media/)). That is simplest, but every picture makes the repository bigger for good. A bucket keeps the files elsewhere and serves each one at its own address: pages store that full address, so the site needs no build step to find them.

Not yet run against the live services by the people who built it: everything here is checked against stand-ins that answer the way R2 and S3 do.

## What changes

- **New uploads go to the bucket** — pictures, PDFs and videos alike, under names that never replace a file already there. Files already in the repository stay where they are until you move them.
- **They are public at once.** A file in the bucket can be loaded by anyone with its address from the moment it is uploaded, before you publish. Keep private documents out of it.
- **Proof lists them** under *In the bucket* until a published page uses them. Discarding a page doesn't remove its uploads; Galley offers to remove the ones nothing uses any more.
- **Deleting is for good.** Galley deletes a file from the bucket only when no page uses it — not the pages waiting in Proof, not the published version — and on a hosted editor only people who can publish may.

## Choose a bucket

| | Cloudflare R2 | Amazon S3 |
| --- | --- | --- |
| Best for | Most sites | Sites already on AWS |
| Charges | What you store; nothing for visitors loading it; a free monthly allowance | What you store and what visitors download |
| Public address | A custom domain on Cloudflare (or r2.dev, for trying out) | The bucket's own address, CloudFront, or your own |

Prices change: see [R2's](https://developers.cloudflare.com/r2/pricing/) and [S3's](https://aws.amazon.com/s3/pricing/).

## Cloudflare R2, step by step

1. In the Cloudflare dashboard, open **Storage & databases › R2 › Overview** (finish Cloudflare's checkout if it asks; R2 has a free allowance). Select **Create bucket** and name it with lowercase letters, digits and dashes.
2. Open the bucket, select **Settings**, and under **Custom Domains** select **Add**. Type an address on a domain already in this Cloudflare account (`media.example.com`), **Continue**, then **Connect Domain**. It turns from *Initializing* to *Active* within minutes. Only trying it out? Under **Public Development URL**, **Enable** gives an r2.dev address — rate-limited, for development only.
3. Back on **R2 › Overview**, under **Account Details**, select **Manage** next to **API Tokens**, then **Create Account API token**. Choose **Object Read & Write** and limit it to this bucket. Copy the **Access Key ID** and **Secret Access Key** (the secret is shown once). The **Account ID** is on the same page.
4. In Galley, open **Media**, select **Keep media in a bucket**, choose **Cloudflare R2**, and paste the account ID, bucket name, public address and the key.

A bucket made in a jurisdiction (such as the EU) is reached at its own S3 address: paste it under *S3 address of a jurisdiction bucket*.

## Amazon S3, step by step

1. In the S3 console, **Create bucket**: pick its Region and a name without dots (a name with dots can't be reached over https at the bucket's own address). Leave **Object Ownership** at *Bucket owner enforced*.
2. Unless CloudFront serves the bucket, let visitors read the files: on the bucket's **Permissions** tab, under **Block public access (bucket settings)**, **Edit**, clear **Block all public access**, and **Save changes**. Then under **Bucket policy**, **Edit** and paste the policy Galley shows — it lets anyone read files in the site's folder, nothing else.
3. In IAM, **Users › Create user**, named after the site, with no console access and no permissions yet. On its **Permissions** tab, **Add permissions › Create inline policy**, choose **JSON** and paste the key's policy Galley shows.
4. On the user's **Security credentials** tab, **Create access key**, choose **Other**, and copy both values (the secret is shown once).
5. In Galley, choose **Amazon S3** and paste the bucket, its Region code (`eu-west-1`), the public address and the key.

The key's policy lets it list, add, read and delete files **in the site's folder** of that one bucket. Even listing carries the folder as a condition, which is why Galley's first check lists that folder rather than asking about the whole bucket.

## What Galley checks

Before it saves anything, Galley does everything the site will need, for real, with a tiny test picture: it reaches the bucket, stores the picture under a new name, reads it back, lists the site's files, loads it from the public address with no key, and removes it. It stops at the first step that fails and says what to change, with the cursor in that field — a key the service doesn't know, a secret that doesn't go with it, a bucket name that doesn't exist, the wrong Region, a key that can read but not write, an address that turns visitors away. A key that fails never replaces one that works.

The key is kept on the computer (or the hosted editor) that runs Galley, never in the site's files; afterwards only its last four characters are shown.

## Move files there and back

In **Media › Storage settings**, **Move files** shows what will happen before anything does: how many files, how many places in how many pages, and what stays.

- **To the bucket**: files are copied, pages are changed to the full addresses, and then the repository's copies are removed (they leave the site when you publish) — unless you keep them. A file used by something Galley can't change in content mode (a template) stays in the repository.
- **Back to the repository**: files come back to the media folder and pages use the site's own addresses again. The bucket keeps its copies until you remove them.
- **A new public address** (a custom domain instead of r2.dev): Galley first checks the new address serves the bucket's files, then changes every page.

Each is safe to run again: what is already there is skipped, and a different file under the same name is reported, never replaced. The page changes wait in Proof like any other.

## From a terminal

```sh
galley media connect --connector r2 --bucket lowfield-media --account <account-id> --public-url https://media.example.com
```

The key is read from `GALLEY_MEDIA_ACCESS_KEY_ID` and `GALLEY_MEDIA_SECRET_ACCESS_KEY`, or asked for with nothing shown; it is never an option. Then:

```sh
galley media move --to bucket
```

`galley media check` runs the check again; `galley media disconnect` sends new files to the repository again (the bucket's files stay). The [command-line reference](/docs/reference/cli/) has every option.

## Next

- [Media](/docs/configuration/media/): the media folders, names and limits.
- [Add images and video](/docs/editing/media/): uploading, for people who edit.
