---
title: Messages in the app
navTitle: Messages in the app
description: The messages an editor can meet in the app, grouped by situation — what each one means and what to do. For whoever supports the people who edit.
group: reference
order: 6
---

This page is for whoever supports the people who edit a site. It lists the messages the app shows, grouped by what the person was doing; [When something goes wrong](/docs/editing/troubleshooting/) is the short version for editors, and [Troubleshooting for developers](/docs/reference/troubleshooting/) covers the command line and the server.

The app's wording is being polished before the first release, so a message may read slightly differently from the one quoted here; search for a few of its words. Many messages have a **Technical details** line: that is what to copy when asking for help.

## Opening the app and a site

| Message | What it means | What to do |
| --- | --- | --- |
| **Can’t reach the app’s server** · *Can't reach the app's server. Check that it's still running, then try again.* | The app's window is open but the part of the app that does the work isn't running, or the connection to it dropped. | If you started the app yourself, start it again, then press **Try again**. If someone runs it for you, tell them. |
| *This site has been closed, so it can't be used from here any more. Open it again to go on.* | The site was closed (taken off the list, a backup put back, the app stopping, or an hour without use) while something still held it from before: an extension or a plugin, a preview's controller, or work still on its way. What it asked after the close was refused. A step that was already running may have saved part of its work before it was stopped; what was saved stays saved, and is in Proof. | Open the site again from the Sites screen and try again. An extension asks `host.sites.get(siteId)` again rather than keeping a site. |
| *Live updates paused — reconnecting* (in the status bar) | The connection to the app's server dropped for a moment. | Nothing: it reconnects by itself. Your changes are saved. |
| *Live updates paused — move the pointer or press a key to reconnect* (in the status bar) | The connection dropped and nobody had touched this window for five minutes, so the app stopped asking for it. Nothing is lost. | Move the pointer, press a key or click in the window: it reconnects at once and reads everything afresh. |
| **Open with your session link.** · *That link has expired. Use the newest one the app printed when it started.* | For safety the app only opens from the link it gave when it started, and that one is old. | Use the newest link, or ask whoever started the app for it. |
| **Sign in to edit.** · *That e-mail and password don’t match an account here. Try again.* | On a hosted editor: the e-mail or the password is wrong, or the account has been switched off. The message is the same whichever it is. | Check both, or use **Forgot your password?** ([Sign in to a hosted editor](/docs/editing/signing-in/#forgot-your-password)). After several wrong tries: *Too many sign-in attempts. Wait a minute, then try again.* |
| **Sign in to edit.** · *Too many sign-in attempts for that e-mail. Wait 15 minutes, then try again.* | Ten wrong tries for that e-mail from this connection in 15 minutes. | Wait 15 minutes, or use **Forgot your password?** |
| **Sign in to edit.** · *That e-mail has more sign-in attempts waiting than can be checked right now. Wait a minute, then try again. …* | Many sign-ins for that e-mail are waiting their turn — someone may be trying to guess it. | Sign in from a browser you have signed in on before (it isn't held up), or use **Forgot your password?**: a link always works. Or wait a minute. |
| **Sign in to edit.** · *This editor is checking a lot of sign-ins right now. Wait a moment, then try again.* | Very many people are signing in at the same moment. | Wait a moment, then try again. |
| **Sign in to edit.** · *That password isn’t right. Try again.* | An editor set up before accounts, whose owner hasn't added an e-mail yet: the password doesn't match. | Check it, or ask whoever set the app up. |
| **This link can’t be used.** | An invitation or new-password link that was used already, taken back, or ran out. | Ask whoever sent it for a new one. |
| **This isn’t part of your account.** | Your role doesn't include this page. | Ask an owner of this editor ([What each role sees](/docs/editing/signing-in/#what-each-role-sees)). |
| *Your account can't do that. Ask an owner of this editor.* | Your role doesn't include what you tried, or it changed while the page was open. | Ask an owner of this editor. |
| *Your account can change the site's content, but not its code and templates (build mode). Ask an owner or an editor of this editor.* | A contributor asked for build mode: the assistant's Build mode, a change to the site's code, or custom code in a form. In a conversation already in Build mode it adds *This conversation is in build mode: switch it to content mode to carry on.* | Ask an editor or owner, or carry on in Content mode. |
| *Your account can't change the site's settings. Ask an owner of this editor.* | The site's settings are an owner's, whichever way they would change — a file, the assistant, discarding or undoing a change to them. | Ask an owner of this editor. |
| *Only an owner can change the e-mail you sign in with. Ask an owner of this editor to change it for you.* | Editors and contributors don't change their own e-mail. | Ask an owner: they change it in People. |
| *Links can't be made yet: this editor doesn't know its public address. Set the editor's public address (GALLEY_PUBLIC_URL), start it again, then make the link.* | An owner tried to invite someone or make a new-password link on an editor that hasn't been told its own address. | Whoever runs the server sets `GALLEY_PUBLIC_URL` and starts it again ([Run a hosted install](/docs/running/hosted/#invitations-and-one-time-links)). |
| *The link was e-mailed to …, and isn’t shown here.* | A new-password link you made was e-mailed to the person it is for. | Nothing; if it doesn't arrive, check their e-mail (**Change e-mail…**) and make a new one. |
| **This site isn’t in your list.** | The site was taken off this app's list. Its pages are untouched. | **Open a site** and choose its folder again. |
| **This site’s folder is missing.** | The site's folder was moved or renamed outside the app. Nothing was deleted by the app. | **Find the folder** and open it from its new place. |
| **Couldn’t open this site** | The app couldn't read the site. | **Try again**. If it keeps happening, send the technical details to whoever looks after your site. |
| **This screen couldn’t be shown** · *Your changes are safe — nothing was lost. Reload the screen, or go back and try again.* | Something in that screen broke. | **Reload screen**. If it happens again in the same place, tell whoever looks after the app. |
| *The app's server couldn't finish this request. Your work is safe.* · *That couldn't be done because of an unexpected problem. Try again.* | An unexpected problem on the app's side. | Try again. If it repeats, send the technical details on. |

## The preview

| Message | What it means | What to do |
| --- | --- | --- |
| **The preview is off.** | Your site isn't running yet. | **Start preview**. It also starts by itself when you open the editor. |
| **Preparing the preview…** | The site is being made ready the first time, which can take a few minutes. | Wait. Open *What it’s doing* if you're curious. |
| **Starting the preview…** | Your site is starting. | Wait a moment. |
| **The preview stopped** · *The preview stopped before it was ready. The log below says why.* | Your site couldn't start — often because of a recent change to its design or settings. | Press **Restart preview** once. If it stops again, send the technical details to whoever looks after your site. You can keep editing in the form meanwhile. |
| **The preview stopped** · *The preview didn't start in time. The log below may say why.* | Your site took too long to start. | **Restart preview**. A slow computer may need a second try. |
| **The preview stopped** · *The preview stopped unexpectedly. Restart it to try again.* | Your site was running and stopped. | **Restart preview**. |
| **The preview stopped** · *This site has no preview command yet. Add one in the site settings (for example “npm run dev”).* | The app doesn't know how to start this site. | A job for whoever looks after your site: it's in **Settings** › **Preview**. |
| **Couldn’t start the preview** / **Couldn’t restart the preview** | The app couldn't start your site. | Try again; then send the technical details on. |
| *The preview isn't answering yet. It will reload by itself.* (inside the preview) | The site is still starting or restarting. | Wait; it reloads on its own. |
| **No live site to compare with.** | The site's settings don't say where the live site is. | **Open site settings** and add the address. See [On the page](/docs/editing/proof-and-publish/#check-your-changes). |
| *Only pages of this site open here. Type a path such as /about/.* | You typed an address from another website into the preview's address box. | Type just the page's part of the address, like `/about/`. |

## Editing in the form

| Message | What it means | What to do |
| --- | --- | --- |
| **This page changed while you were editing** | The page changed at the very moment you were typing, so your last edit wasn't saved on top of it. What you typed is listed. | **Put my edits back** to apply them to the newer version, or **Keep the newer version**. See [the form](/docs/editing/form/#if-somethings-different). |
| **Couldn’t save your last edit** · *Your edit is still in the form. Check that the app’s server is running, then try again.* | The app's server couldn't be reached when it tried to save. | **Try again** once the app is running. Don't close the window first. |
| *The assistant changed this page. The form shows its edits.* | A quiet note: the form now includes the assistant's change. | Nothing. |
| *This page changed outside the app. The form shows the latest version.* | Another program on this computer changed the page — a developer's editor, for example. | Nothing. The form is up to date. |
| *This isn’t a number yet, so it hasn’t been saved.* | A number field has something in it that isn't a number. | Type digits only. |
| *Written in a format the date picker can’t show, so it’s kept as typed.* | The date was written in an unusual way. It still works. | Nothing, or pick a date to replace it. |
| *The swatch can only show hex colors like #2E2BFF.* | The colour is written in a way the small swatch can't show. | Nothing, or type a code like `#2E2BFF`. |
| *“Title” is required.* (or another field's name) | A required field is empty. | Fill it in. You can still publish, but the page may not show as intended. |
| *“Date” should be a date like 2026-03-14.* | The field has the wrong kind of value. | Correct it as the message says. |
| *The link to /contat/ in … doesn't match any page on the site.* | A link goes to a page that doesn't exist. | Check the address. Typing in a link field suggests real pages. |
| *… uses /images/hero.png, which isn't in the site's media folders.* | The page asks for an image that isn't in media. | Choose another image, or upload it. |
| *“…” isn't one of the fields this content type defines. It is kept as it is.* | The page has an extra piece of information the site doesn't describe. | Nothing; it's kept as it is. |
| *This section type isn’t described by the site, so its fields get plain controls.* | A section of a kind the site doesn't describe. Its fields are plain text boxes. | Edit with care, or ask whoever looks after your site. |
| *This can’t be read yet — check the brackets, quotes and commas. It isn’t saved until it can.* | A data box has a typing slip in it. | Fix the slip; it saves as soon as it can be read. |
| **This can’t be read yet, so the last change isn’t saved** (in **Source**) | Something typed in Source can't be read. | Check the line it points to — usually a missing quote, colon or indent. The form keeps the last version that could be read. |
| **Nothing to edit at this address.** | The preview is showing a page whose words aren't stored as content — a list of posts, for example — so there's no form for it. | Follow a link in the preview to a page you can edit, or choose one from the sidebar. |
| **Couldn’t open this page** · *This item no longer exists. It may have been moved or deleted.* | The page you were going to was moved or deleted. | Go back to the list and open it from there. |
| *A post with that address already exists. Choose a different name.* | Two pages can't have the same address. | Change the address in the **New post** window. |
| *That address can't be used for a post. Use plain words without slashes.* | The address has characters it can't use. | Use plain words separated by hyphens. |

## Clicking on the page

| Message | What it means | What to do |
| --- | --- | --- |
| **Which one did you mean?** · *This text appears in 2 places. Choose the one you meant.* | The same words are stored in more than one place. | Choose the one you clicked. See [“Which one did you mean?”](/docs/editing/on-the-page/#when-it-asks-which-one-did-you-mean). |
| *This text appears in 12 places, which is too many to tell which one this is.* | Too many places hold these words. | Change it in the form instead. |
| *The selected text is too short to find reliably.* · *The selected text has no words to look for.* | The words clicked are too short (a single letter, a symbol) to look for. | Change it in the form. |
| **This text is part of the site’s design.** | The words aren't stored with the page's content. | See [what to do about design text](/docs/editing/on-the-page/#if-somethings-different). |
| **This image can’t be swapped by clicking.** | The image isn't one of the page's own image fields: it's in a section, or part of the design. | **Show the form** and change it in the section's image field; if it's part of the design, **Ask the assistant** (in Build mode) or whoever looks after the design. |
| *Couldn’t find where this text lives.* · *Couldn’t find where this image lives.* | The app couldn't look it up just then. | Try again, or change it in the form. |
| *Couldn’t change it.* followed by a reason | The change was refused, and the reason says why. | The page reloads to show what's really stored. Follow the reason, or use the form. |
| *Nothing changed.* | The words you typed are the same as before. | Nothing. |

## The assistant

| Message | What it means | What to do |
| --- | --- | --- |
| **Connect the assistant.** · *Connect the assistant first: add an Anthropic API key in Settings.* | The assistant has no key yet, so chat is off. Everything else works. | **Open settings**, or ask whoever set up the app — see [Connect the assistant](/docs/getting-started/assistant/). |
| *The assistant can't connect: the API key in Settings was rejected. Add a fresh key in Settings.* | The key was turned down — it may have been withdrawn. | Whoever manages the key adds a new one in **App settings** › **Assistant**. |
| *The assistant's API account is out of credit. Add credit to the account, then try again.* | The account that pays for the assistant has run out. | Whoever pays for it tops it up. |
| *This API key isn't allowed to use the chosen model. Pick another model in Settings, or check the key's access.* · *The chosen model isn't available to this API key. Pick another model in Settings.* | The assistant's settings ask for something the key can't use. | Choose another **Model** in **App settings** › **Assistant**, or ask whoever manages the key. |
| *Couldn't reach the assistant. Check this computer's internet connection, then try again.* | No internet connection, or it dropped. | Check the connection and send the request again. |
| *The assistant took too long to answer, so I stopped waiting. Try again in a moment.* | No answer came in time. | Send the request again. |
| *The assistant has had too many requests in a short time. Wait a minute, then try again.* · *The assistant is overloaded right now. Try again in a minute.* · *The assistant's service had a problem. Try again in a minute.* | A temporary problem at the assistant's end. | Wait a minute, then send the request again. |
| *The assistant couldn't accept that request. Try again; if it keeps happening, start a new conversation.* | Something in this conversation got in the way. | Try again; then **New chat**. |
| *The assistant stopped unexpectedly. Nothing else was changed. Try again.* | It stopped part-way. Any change it reported before stopping is in Proof. | Check Proof, then ask again. |
| *I'm still working on the last message. Wait for it to finish, or stop it first.* | It's still on your previous request. | Wait, or press **Stop**. |
| *That message is too long. Keep it under 20,000 characters, or split it up.* · *That message is too large to send. Try fewer or smaller images.* | Too much in one message. | Split it, or attach fewer or smaller images. |
| *“plan.docx” isn’t an image. Attach PNG, JPG, WebP, GIF, AVIF or SVG files.* | Only images can be attached. | Attach an image, or paste the text into your message. |
| *“photo.jpg” is 14 MB, larger than 10 MB. Make it smaller and attach it again.* | Attached images can be up to 10 MB each. | Make a smaller copy and attach that. |
| *Only 6 images fit in one message, so “photo.jpg” wasn’t added.* | Six images is the most per message. | Send the rest in a second message. |
| *Build mode is turned off for this site, so the assistant can change content only.* | This site doesn't allow design changes from the assistant. | Ask whoever looks after your site. |
| *Wait for the current reply to finish before undoing.* | You can't undo while it's working. | Wait for the reply, or press **Stop**, then undo. |
| *That reply can't be undone from here any more — only the last 20 replies in a conversation can, and not after the app restarts. You can still discard its changes in Proof.* | That reply is too far back to undo from the chat. | Put its changes back in [Proof](/docs/editing/proof-and-publish/#put-back-what-you-dont-want). |
| *That can't be undone from here any more: what Undo kept was let go, because the site was closed or nothing used it for an hour. You can still discard the changes in Proof.* | Undo's memory of a reply, of a batch of search fixes, or of an extension's work was let go: the site was closed under it (taken off the list and added again, or a backup put back), or, for anything but an assistant's reply, it went unused for an hour. A site isn't closed for lack of use while an assistant's reply still offers its Undo. Nothing was put back. | Put the changes back in [Proof](/docs/editing/proof-and-publish/#put-back-what-you-dont-want). |
| **Couldn’t open this chat** · *That conversation doesn't exist any more.* | The conversation was deleted, perhaps in another window. | **New chat**. |
| A line under the reply starting *Couldn't* — for example *Couldn't edit the About page* — and a reply saying what didn't change | One step was refused. The reply says why in plain words, and what you can do instead. | Follow the reply's suggestion. Nothing it says didn't change was changed. |
| A reply saying it can't change the design in Content mode | The request needs Build mode. | Switch to **Build** if your site offers it — see [Content and Build](/docs/editing/assistant/#content-and-build) — or ask whoever looks after the design. |

## Images and media

| Message | What it means | What to do |
| --- | --- | --- |
| *Only images, MP4 videos, and PDFs can be added to media.* · *“notes.docx” isn't an image, MP4 video, or PDF, so it can't be added to media.* | That kind of file can't go in media. | Add images (PNG, JPG, WebP, AVIF, GIF, SVG), PDFs or MP4 videos. |
| *That file is too large. Media files can be up to 25 MB.* | The file is over the limit. | Make a smaller copy — it'll load faster for visitors too. |
| *That file doesn't look like a valid image.* | The file is named like an image but isn't one inside, or is damaged. | Open it on your computer and save or export it again. |
| *That file is empty.* · *That upload couldn't be read. Choose the file again.* | The file arrived empty or garbled. | Add it again. |
| **Couldn’t add that image** | A file dropped on an image field couldn't be added; the reason follows. | As for the reason. |
| **The image provider needs attention** · *Image generation isn't set up yet. Choose an image provider in Settings.* | No image service is chosen for making images. | **Open settings** › **Images**, or ask whoever set up the app. See [Placeholder artwork](/docs/editing/media/#make-an-image-from-a-description). |
| **The image provider needs attention** · *Add an OpenAI API key in Settings to generate images with OpenAI.* (or Google AI) | The chosen image service has no key. | Choose **Placeholder artwork (offline)** for now, or ask whoever manages the keys. |
| **Couldn’t make that image** · *OpenAI couldn't make the image. Try again.* | The image service didn't return a picture. Nothing was added to media. | Try again, perhaps with a different description. |
| *Describe the image you want in a few words.* · *That description is too long. Keep it under 4,000 characters.* | The description is missing or too long. | Write a sentence or two. |
| *That generated image has expired. Generate it again.* | Made images are only kept for a while until you save one. | Press **Make images** again. |

## Proof and publishing

| Message | What it means | What to do |
| --- | --- | --- |
| **Couldn’t read what’s waiting** | Proof couldn't load the list of changes. | **Try again**. Your changes are still there. |
| **Couldn’t discard** · **Couldn’t put back …** | The change couldn't be taken back. | Try again; the reason under the title says more. |
| **Publishing is paused** · *The repository has newer versions than this copy, so nothing was published and nothing was overwritten. Your edits are safe. Get the latest versions, then publish again.* | Someone published from elsewhere since this copy last looked. | **Get the latest**, then publish again. |
| **Publishing is paused** · *The repository has newer versions that change about.md, which has unpublished changes here. Galley can't join the two, so nothing was published and nothing was overwritten. Discard the change to that file (Proof shows it, so what you wrote can be copied first), get the latest versions, then make the change again.* | Someone published a change to a page you have changed too. Getting the latest would be refused for the same reason. | **Review in Proof**: copy what you wrote, discard your change to that page, get the latest versions, then make the change again. |
| **Saved, not live yet** · *Couldn't reach the code host. Your change is saved on this computer — check your connection and publish again.* (or *…in time…*) | A version was recorded here, but it couldn't be sent: no internet connection, or the connection was too slow. | Check the connection, then **Try sending again** — or later, **Send now** in the status bar or in Version history. |
| **Saved, not live yet** · *Someone else published first — pull the latest and try again.* | Someone published to the site while you were working, so your version and theirs need combining before yours can go live. Both are safe. | Ask whoever looks after your site to combine them; sending again won't help until they have. (**Get latest** can't combine them by itself, and says so.) To avoid this, press **Get latest** in Version history before you start editing. |
| **Saved, not live yet** · *The code host didn't accept your sign-in. Make sure you're signed in to it on this computer, then publish again.* | This computer isn't allowed to publish to the site. | Ask whoever looks after your site to give this computer access. |
| **Saved, not live yet** · *The code host doesn't allow changes to go straight to this branch. Publish as a pull request instead.* | The site only accepts changes that have been reviewed. | Ask whoever looks after your site to switch publishing to **Send for review**. |
| **Saved, not live yet** · *The site's code host address doesn't point at a repository you can publish to. Check the site's connection settings.* · *Your change is saved on this computer, but sending it to the code host didn't work. Try publishing again in a moment.* | Sending failed for a reason on the host's side. | **Try sending again** in a while, or **Send now** later; if it keeps failing, send the technical details on. |
| **Couldn’t publish** · *The site's own checks stopped the publish, so nothing was published. Fix what they report, then try again.* (or *…took too long…*) | The site runs its own checks before a publish, and they found a problem. | Send the technical details to whoever looks after your site. |
| **Couldn’t publish** · *Another program is using this site's version history right now. Wait a moment and try again.* · *Version history took too long to respond, so the action was stopped. Try again.* | Something else on this computer was busy with the site. | Wait a moment and press **Try again**. |
| **Couldn’t publish** · *Publishing is set to go to “main”, but the site is on “draft” right now. Switch to main, or change where publishing goes in the site settings.* · *The site isn't on a branch right now (someone checked out an older version), so there's nowhere to publish. …* · *The site's version history is in the middle of another operation that was started outside the app. …* | The site's folder is in a state that needs a developer's hand. | Send the message to whoever looks after your site. Your changes are safe. |
| **Couldn’t publish** · *This folder isn't under version control yet, so there's nowhere to publish to. …* · *Git isn't installed on this computer. …* | This computer or folder isn't set up for publishing yet. | A job for whoever set up the app. |
| **Couldn’t publish** · *The very first version of a site can't be sent as a pull request. …* · *Pull requests need the site to be connected to a code host, and this one isn't. …* | Review mode can't work on this site yet. | A job for whoever looks after your site. |
| **Couldn’t send for review** | Sending for review failed. Your changes are still in Proof. | **Try again**; then send the technical details on. |
| **Couldn’t send** · followed by the reason and *The versions stay saved here, ready to send.* | **Send now** (or **Try sending again**) couldn't send the waiting versions. Nothing is lost. | Follow the reason — the rows above explain each one — and try again later. |

## Version history

| Message | What it means | What to do |
| --- | --- | --- |
| **Couldn’t load the version history** · **Couldn’t check for newer versions** | The list couldn't be read just now. | **Try again**. |
| *The newer versions change about.md, which has unpublished changes here. Discard the change to that file (Proof shows it, so what you wrote can be copied first), then the newer versions can come in.* | Someone else published a change to a page you're working on. Galley can't join the two, and publishing is paused while newer versions wait. | Copy what you wrote from Proof, discard your change to that page, press **Get latest**, then make the change again. |
| **Couldn’t get the latest versions** · *Some files you've changed here were also changed in the latest version. Discard your changes to those files (Proof shows them, so what you wrote can be copied first), then try again.* | The same, found at the moment the versions were being brought in. | Copy what you wrote from Proof, discard your changes to those pages, then **Get latest** again. |
| **Couldn’t get the latest versions** · *This copy has versions that aren't on the code host yet, and the code host has newer ones, so they can't be combined automatically. Ask a developer to combine them.* | One of your publishes wasn't sent, and someone else has published since. | Ask whoever looks after your site to combine them. Your edits are safe. |
| **Couldn’t undo this publish** followed by a reason | The undo would have overwritten other work, or the repository has newer versions than this copy, so nothing was changed. | See [When an undo can't be done automatically](/docs/editing/history/#if-somethings-different). |
| **Undone here, not live yet** · *The undo is recorded on this computer but didn’t reach the site’s host.* followed by the reason | As with **Saved, not live yet**: recorded here, not sent. | **Send now**, in the note or in Version history. |

## Settings

| Message | What it means | What to do |
| --- | --- | --- |
| **Couldn’t save the settings** · *The site settings have a problem: …* | One of the values can't be used; the message says which. | Correct it, or press **Reset** to go back to what was saved. |
| *Ports are whole numbers from 1 to 65535.* | The preview's port must be a number. | A developer setting: leave it empty to use the detected one. |

## Still stuck?

Send whoever looks after your site three things: what you were doing, the message exactly as it appeared, and its **Technical details** if it had them. Your changes will wait in Proof in the meantime.

## Next

- [Find your way around](/docs/editing/tour/) — back to the start of the editing guide.
