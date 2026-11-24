---
title: Sign in to a hosted editor
navTitle: Sign in and your account
description: For people who use an editor someone runs online — signing in, joining from an invitation, your account, what owners, editors and contributors each see, and a forgotten password.
group: editing
order: 1.5
---

For people who edit a site through an editor someone runs online, at an address like `cms.example.com` — a **hosted editor**. Everyone there has their own account: an e-mail, a password, and a role the owner chose. On the desktop app, or Galley on your own computer, there is nothing to sign in to and none of this applies.

> **Status.** Accounts are new. They are covered by automated tests, a rehearsal against the real server and a pass in a real browser, but haven't yet been tried with real e-mail, and the new-password and forgotten-password pages haven't been driven in a browser. If something here reads differently in the app, the app is right; tell whoever runs the editor.

## Join from an invitation

An owner of the editor invites you. You get a link — by e-mail, or from the owner — that looks like `https://cms.example.com/join#…`.

1. Open it. The page says **You’re invited.**, who invited you and as what (for example, "Sam invited robin@example.com to edit this site as Editor."), with a line on what that role can do.
2. Type **Your name** and a **Password** (12 characters or more), and the same password again. Your name is what the editor shows the others who use it, and, if your role publishes, what your publishes carry.
3. Press **Join**. You're signed in, and the site opens.

The link works once, and stops working after 7 days. If it says **This link can’t be used.**, it was used already, taken back, or ran out: ask whoever sent it for a new one.

If it says *Too many tries from here. Wait a minute, then try again.*, too many wrong links or passwords came from your connection in the last minute. The link is still good: wait a minute, then press **Try again**. The same goes for a new-password link.

## Sign in

The sign-in page says **Sign in to edit.** Type your e-mail and password and press **Sign in**.

If either is wrong, or your account has been switched off, the page says *That e-mail and password don’t match an account here. Try again.* — the same words whatever was wrong, so nobody can use the page to find out who has an account. After 5 wrong tries from your connection in a minute (or 20 tries of any kind), the page says *Too many sign-in attempts. Wait a minute, then try again.*; after 10 wrong tries for one e-mail from your connection in 15 minutes, *Too many sign-in attempts for that e-mail. Wait 15 minutes, then try again.*

**A browser you have signed in on before is never held up** by wrong tries from anywhere else. In a browser you haven't used here before, signing in to an e-mail that someone is trying to guess can be slow — it waits its turn, sometimes up to a couple of minutes — or the page says *That e-mail has more sign-in attempts waiting than can be checked right now. Wait a minute, then try again. …* Then sign in from a browser you have used before, or use **Forgot your password?** (or ask an owner for a new-password link): a link is never held up. When very many people are signing in at the same moment, the page can also ask you to wait a moment.

An editor that was set up before accounts asks for **the password alone** until its owner adds their e-mail.

## Forgot your password?

Press **Forgot your password?** under **Sign in**.

- **When the editor e-mails links**, type your e-mail and press **Send the link**. The page always ends on *If that address has an account here, a link is on its way.* The link is good for 60 minutes, once.
- **When it can't**, the page says to ask an owner of this editor for a new-password link. They make one and send it to you.

A new-password link looks like `https://cms.example.com/new-password#…`. It opens **Choose a new password.**, for your e-mail: type the new one twice and press **Save password**. Your old password keeps working until you choose a new one; choosing it signs you out of every other browser.

## Your account

Your name and initials are at the right of the top bar. Its menu shows your name and role, **Your account** and **Sign out**. **Your account** is in the sidebar too.

- **You**: your name and e-mail. Change your name here. The e-mail is an owner's to change: an owner changes their own here, with their current password (it's where a new-password link goes); editors and contributors see theirs with *An owner of this editor can change it* and ask an owner. An account with no e-mail yet adds one here. If your role publishes, your publishes carry your name and e-mail from then on; a contributor's name is how the others who use the editor know them.
- **Role**: your role, and what it allows. Only another owner can change it.
- **Password**: change it here. Your other browsers are signed out; this one stays signed in.
- **Sign out everywhere**: signs you out of every browser, this one included. Other people stay signed in.
- **Appearance**: for editors and contributors, the app's theme, kept in this browser only (an owner sets it for everyone in App settings).

## What each role sees

| | Owner | Editor | Contributor |
| --- | --- | --- | --- |
| Change pages, images and forms; ask the assistant in Content mode; the redirects list; the preview and Proof | yes | yes | yes |
| Discard changes in Proof | yes | yes | yes |
| The assistant in Build mode; set-up helpers that change the site's code (forms and scripts set-up, the AI-readable version, the inbox address); custom code in forms and scripts; plain robots.txt rules; removing a leftover redirects file; rebuilding a page after an import | yes | yes | — |
| Publish, Undo this publish, Get latest, Send now | yes | yes | — |
| Put the site live, share a preview link, set redirects on Cloudflare | yes | yes | — |
| The inbox (what visitors sent through the site's forms) | yes | yes | — |
| The Install page and People, App settings, Plugins, the site's Settings, where the site is hosted and where its redirects take effect | yes | — | — |
| Change an e-mail address — your own, or someone else's in People | yes | — | — |

The assistant offers you only what your role includes, and the editor itself checks every change against your role, whichever way you ask — a screen, the assistant, a file.

**As a contributor**, where **Publish** would be, the top bar says *An editor or owner publishes.* (pointing at it, or a screen reader, gives the whole sentence: *You can change the site and see Proof. An editor or owner publishes.*), and Proof says *Nothing goes live until an editor or owner publishes.* Wherever the app would say *until you publish* — under **What would you like to change?**, in **Waiting to publish**, after deleting something — it says *until an editor or owner publishes*.

The assistant has no **Build** switch for you: it works in Content mode. Where the app would offer to change the site's code — **Set it up for me** for forms and scripts, turning on the AI-readable version, **Send them to this inbox**, custom code in a form or a script, rebuilding a page after an import — one line says who can instead, such as *Setting it up changes the site’s code. An editor or owner can do it.* or *An editor or owner can add or change custom code.* If you ask for build mode anyway, the editor answers *Your account can change the site's content, but not its code and templates (build mode). Ask an owner or an editor of this editor.*

**As an editor or a contributor**, a page you can't use (from a bookmark or a link) shows **This isn’t part of your account.**, with a way back to the site; links to settings pages read *An owner of this editor can set this up.* An old setup link (`/setup`) takes you into the app. Stored keys show whether they are set, never their last characters: only owners see those. On **Redirects**, *An owner of this editor chooses where the site is hosted.*, and the Cloudflare account and domains are shown but not changed. The site's settings are an owner's whichever way they would change: a change to them that you try is answered *Your account can't change the site's settings. Ask an owner of this editor.*

**Everyone shares one draft.** Changes anyone makes wait in the same Proof, and **Discard** throws away the pending changes there — everyone's, not only yours (a change to the site's settings only an owner discards). Say before you discard, and publish often.

**Who published.** When you publish, the version is recorded with your name and e-mail, and the Publish dialog says so ("Recorded as Robin Park (robin@example.com), from your account."). Version history shows it.

## For owners

An owner sees everything, plus **People** on the Install page:

- **Invite someone**: an e-mail and a role. The link is shown once, with **Copy link**; the dialog says whether it was also e-mailed and when it stops working. Open invitations are listed with a **Take back** button. To send a new link, take the invitation back and invite again.
- **For each other person** (the **…** menu): **Change e-mail…** (the address they sign in with; their open new-password link stops working), **New-password link** (works for 1 hour, once), **Sign out**, **Switch off** or **Switch on**, and **Remove…** — what they published keeps their name.
- **A new-password link**: when the editor e-mails it to the person, the dialog says *The link was e-mailed to …, and isn’t shown here.* — it stays with them. When it can't be e-mailed, it is shown once, with **Copy link**, for you to send.
- **Their role**: choose Owner, Editor or Contributor beside their name. It applies to their next action.
- **Sign everyone out…**: everyone, you included.

The editor always keeps at least one owner who can sign in, and nobody changes their own role or account through People: ask another owner. Your own e-mail you change on **Your account**. When the editor doesn't e-mail links, People says *This server doesn’t e-mail links, so copy each one and send it yourself. Whoever runs the server can have it e-mail them — the guide to running this editor says how.*

An owner of an editor set up before accounts is asked once, right after signing in, to **Add your name and e-mail** (with their current password). **Not now** puts it off until the app is next opened; until then they can't invite anyone.

## If you're locked out as the only owner

Whoever runs the server can make you a new-password link ([Run a hosted install](/docs/running/hosted/#a-forgotten-password)). Nothing else changes, and your old password works until you use the link.

## Next

- [Find your way around](/docs/editing/tour/).
- [Check and publish](/docs/editing/proof-and-publish/).
- [Run a hosted install](/docs/running/hosted/#people-and-roles) — the same thing from the side of whoever runs it.
