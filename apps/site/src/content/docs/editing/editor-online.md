---
title: Host the editor online
description: Put an editor for this site online on your own account — Fly.io, Google Cloud, Cloudflare in front of a computer of yours, or any server with Docker — so it can be edited from any browser, with what each costs.
group: site
order: 7.5
---

For people who look after a site. **Put this site online** puts the *site* at a real address; **Host the editor online** puts the *editor* there too, so the site can be edited from any browser, not just this computer. The editor runs on your own account with a host, for this one site, with its own password. Nothing is run by Fiction Tribe: Galley Cloud, a managed service, is [coming later](/cloud/).

*Status: new in 0.2.0 and still in progress. Run on 2026-11-24 from the real app in a real browser against strict stand-ins for Fly.io and Cloudflare, with the stand-in's machine started as a real editor: the plan and its cost shown before anything, nothing created before the yes, the editor created and answering, and removal deleting exactly what was created. Google Cloud was added after that and has run only against a strict stand-in for Google's APIs, in the tests. Not yet run against Fly.io, Google Cloud or Cloudflare themselves. The editor's image isn't published yet, so for now this needs an image you built and pushed (`GALLEY_HOSTING_IMAGE`). What was run, exactly: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#what-has-been-run).*

## Where it can run

Prices are rough, for one editor a month, from each provider's own page as read on the date given. The app shows the same figures, with their source and date, before anything is created.

| Where | What gets created | About a month |
| --- | --- | --- |
| **Fly.io** | Everything, on your Fly.io account: the editor, its disk (3 GB, growing up to 10 GB), its addresses and certificates. | 2 GB of memory awake all day: $13.24; awake about 3 hours a day (it sleeps while nobody uses it, the default): $2.27. With 1 GB: $7.25 and $1.52. [Fly.io's prices](https://docs.fly.io/about/pricing/), read 2026-11-23; the 2 GB price is worked out from its rates. A card is needed on the account. |
| **Google Cloud** | Everything, in your Google Cloud project: a virtual machine of its own (2 GB, or 4 GB for a site whose repository holds much more than the site), a 20 GB disk, a network of its own with one firewall rule for the web ports (no SSH), and a fixed address. The machine installs Docker and starts the editor with Caddy for HTTPS by itself. | 2 GB (e2-small): $17.88 — the machine $12.23, the disk $2.00, the fixed address $3.65. With 4 GB (e2-medium): $30.11. On-demand prices for Iowa (us-central1), worked out at 730 hours a month from Google's hourly prices ([machines](https://cloud.google.com/products/compute/pricing/general-purpose), [disks](https://cloud.google.com/compute/disks-image-pricing), [addresses](https://cloud.google.com/vpc/network-pricing), read 2026-11-24): an estimate to check there. |
| **Cloudflare, in front of a computer of yours** | A tunnel and three names on your Cloudflare account. The editor runs on any computer of yours with Docker, and no port is opened on it. | Nothing at Cloudflare — "Every account includes 1,000 tunnels at no cost" ([Cloudflare](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/), read 2026-11-23) — plus what the computer costs. |
| **Any server with Docker** | Nothing on an account: the app writes the files, you start them on the server. Caddy gets the certificates. | The server: a DigitalOcean Basic Droplet with 2 GB is $12.00 ([DigitalOcean](https://www.digitalocean.com/pricing/droplets), read 2026-11-23); Hetzner's CPX12 is from €9.99 before VAT ([Hetzner](https://www.hetzner.com/cloud/regular-performance/), read 2026-11-23). |

**Why not Vercel?** Vercel runs short functions that stop after a few minutes, on a disk that doesn't keep files, and the editor needs a computer that stays on with a disk that keeps your unpublished changes ([Vercel's limits](https://vercel.com/docs/functions/limitations), read 2026-11-23) — put the site on Vercel, and the editor on Fly.io or a server of your own.

**Why not Cloudflare's containers?** They start again with a fresh disk after every sleep, restart or update — "All disk is ephemeral by default" ([Cloudflare](https://developers.cloudflare.com/containers/platform-details/), read 2026-11-23) — so unpublished changes would be lost. Choose Cloudflare in front of a computer of yours instead.

## Put it online

1. Open **Online** in the sidebar. Under **Editor online**, choose **Host the editor online**.
2. **Where the editor runs**: choose one of the four.
3. **Connect** the host: make an access key on its site with the permissions listed, in that order, and paste it. It is checked with the host before it is kept — on this computer only — and the app then asks the host what the key can do. If something is missing, it says exactly what and where to add it. For Google Cloud the key is a key file from Google Cloud (a service account's JSON key): turn on the Compute Engine API in the project, create a service account with the roles **Compute Instance Admin (v1)**, **Compute Network Admin** and **Compute Security Admin**, then **Keys › Add key › Create new key › JSON**, and paste the whole file.
4. **The editor's address**, like `cms.example.com`, on a domain that's yours. The editor uses three names: its own, one for the preview of your changes (`cms-preview.example.com`) and one to compare with the live site (`cms-live.example.com`). **Change these names** sets the other two yourself — needed for an address like `example.co.uk`, whose worked-out names would be someone else's. Choose the account, where it runs, and the host's own choices (memory, sleeping while unused).
5. **What the new editor gets from this site**: the repository's address, the publishing name and e-mail, the live address. Keys are copied only if you tick each one; none is ticked to start with. The editor gets its own password and its own key for the repository — this computer's aren't copied.
6. **Read the plan**: everything that will be created, what it costs a month, what is handed over, and what you'll do by hand (DNS names, files to start). Nothing has been created yet. Then say yes.

When the editor answers at its address, the site is handed over and this site's settings note where its editor lives (`editor` in `galley.config.json`). That change shows in Proof here, to publish like any other. Then **Finish setting it up** opens the editor's first run: choose its password and add its key to the repository, with write access.

## Afterwards

The **Editor online** card shows whether the editor answers and its version.

- **Upgrade to …** — when this app is newer, moves the editor to the new version. Its disk and everything on it stay as they are. On Google Cloud the virtual machine is shut down cleanly and started again, which takes a minute or two.
- **Back up** — on Fly.io, a copy of the editor's disk that Fly.io keeps for 7 days; on Google Cloud, a snapshot of its disk that stays in the project until you delete it (removing the editor leaves it). To keep a backup of your own, download one from the editor's Install page.
- **Remove the hosted editor** — lists exactly what will be deleted and leaves alone anything changed since it was created. Changes on the editor that were never published go with it. The site, its repository and its live address stay.

An editor set up from another computer can be opened from here, but upgraded or removed only from there or on the host itself.

## From a terminal

`galley host` does the same; `--dry-run` prints the plan and stops:

```sh
galley host --host own-server --address cms.example.com --name acme --dry-run
```

```output
Any server with Docker: the editor “acme”
  Editor:          https://cms.example.com
  Preview:         https://cms-preview.example.com
  Live comparison: https://cms-live.example.com
…
Costs about $12.00 a month:
…
Nothing was created (--dry-run).
```

Then `galley host status`, `check`, `upgrade`, `backup` and `remove`; `--preview-address` and `--live-address` set the other two names. Until a release carries it, run it from a clone of the repository. Every option: [Command line](/docs/reference/cli/#galley-host).

## Next

- [Run a hosted install](/docs/running/hosted/) — the editor's first run, backups and upgrades, for whoever looks after it.
- [Put this site online](/docs/editing/online/).
