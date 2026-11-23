---
title: Hand a site over to an editor
navTitle: Hand a site over
description: A checklist for the developer or agency setting Galley up for someone else — names and labels, the live address, where publishes go, what the assistant may touch, and how they will run it.
group: getting-started
order: 5
---

This page is for the developer or agency who builds a site and then hands it to the people who edit it. Everything below is optional — Galley works on a folder with no configuration — but each item removes a question your editor would otherwise ask you.

## 1. Check what detection found

```sh
$ galley doctor ~/sites/client-site
```

Read the collection lines as your editor will see them: is *Blog posts* called what they call it, are the counts right, is a folder of partials showing up as a collection? Then run `galley init` to get a `galley.config.json` that lists each collection's id, label and URL pattern, and correct only what is wrong. [Configuration](/docs/configuration/) explains the file; it is committed with the site.

## 2. Name things in their words

In `galley.config.json`, per collection: `label` (plural, *Journal*), `singular` (*post*), and per field: `label`, `description` (help text under the field, also given to the assistant), `options` for a fixed list, `hidden` for keys nobody should touch.

```json galley.config.json
{
  "name": "Harbour Bakery",
  "collections": [
    {
      "id": "blog",
      "label": "Journal",
      "singular": "post",
      "fields": [
        { "key": "description", "label": "Summary", "description": "One or two sentences for search results and link previews." },
        { "key": "legacyId", "hidden": true }
      ]
    }
  ]
}
```

## 3. Give it the live address

Set `urls.production` (and `urls.staging` if there is one) so the proof can show the proposed page beside the deployed one. On an Astro site, the `site:` value in `astro.config.*` is read automatically — unless it is a placeholder such as `https://www.example.com`, which is ignored on purpose.

## 4. Decide where a publish goes

- **Commit and push** (the default) to the branch that is checked out. Make sure the machine or server Galley runs on can push: Galley uses git's own credentials and never asks for a password.
- **Pull-request mode** (`"publish": { "mode": "pull-request" }`) puts each publish on a new `galley/…` branch and hands back the pull request, for teams that review before going live. With the GitHub CLI (`gh`) signed in, Galley opens the pull request; without it, it gives the compare link.

[Publishing](/docs/configuration/publishing/) has the details.

## 5. Decide what the assistant may touch

Content mode — content and media — is the default for every conversation. Build mode adds source files and the site's build, which is powerful in an editor's hands. To keep the assistant to content only on this site, turn build mode off:

```json galley.config.json
{
  "ai": { "allowBuild": false, "instructions": ["CONTENT-GUIDE.md"] }
}
```

This switch governs the assistant. It is not an access control: anyone who can sign in to Galley can still change source files through the HTTP API (`PUT …/file` with `"mode": "build"`). `ai.instructions` lists files the assistant reads before each conversation — a style guide, a voice document. Galley picks up `STYLE.md`, `BRAND.md`, `VOICE.md`, `brand/voice.md` and a few other common names on its own; list yours if it is called something else. See [Modes and the write surface](/docs/concepts/modes/).

## 6. Move copy out of components

Words written into an `.astro` component can't be edited in content mode, and click-to-edit says so (*This text isn't in any content file.*). Put interface text — button labels, footer lines, menu items — in a data file under `src/data/` and read it in the component. [Making an Astro site easy to edit](/docs/astro/editable-sites/) shows the pattern the starter uses.

## 7. Choose how they will run it

| They… | Give them | Read |
| --- | --- | --- |
| work on their own computer and don't use a terminal | the desktop app (unsigned builds today) | [Desktop app](/docs/running/desktop/) |
| are a team, or shouldn't install anything | a hosted Galley behind a password, on HTTPS | [Hosting for a team](/docs/running/hosted/) |
| are comfortable with a terminal | the command line, `galley` in the site's folder | [Command line](/docs/reference/cli/) |

On every machine, set the author identity in App settings › You (it starts from this computer's git `user.name` and `user.email`): publishes are committed as that person.

## 8. Do one round trip together

Change a heading, open the proof, publish, find it in Version history, and undo it. That is the whole loop your editor needs, and it proves the credentials, the branch and the live address are right before you leave.

## Next

- [Prompt, proof, publish](/docs/concepts/prompt-proof-publish/) — the loop, for explaining it.
- [Security model](/docs/running/security/) — what to tell whoever approves the setup.
