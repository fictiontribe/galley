---
title: Make a form
description: Build a contact, sign-up or enquiry form in the form builder, choose where its submissions go, and put it on a page.
group: site
order: 1
---

For people who look after a site. Each form is a file in the site, so building or changing one is a change like any other: it waits in Proof and goes live when you publish.

## Make one

1. Open **Forms** in the sidebar and press **New form**.
2. Start from **Blank**, **Contact**, **Newsletter sign-up**, **Demo request**, **Event registration** or **Gated download**. Give it a **Name**; the **Form id** is filled in for you. Press **Create form**.
3. The form builder opens on **Fields**:

<figure class="frame" style="padding: clamp(12px, 3vw, 28px); margin-block: 0 1.15em"><img src="/docs/form-builder@1x.webp" srcset="/docs/form-builder@1x.webp 1x, /docs/form-builder.webp 2x" alt="The form builder on Caddow's Write to the workroom form: field types on the left, the form as visitors see it in the middle, and the form's name, button text and appearance on the right, under the tabs Fields, Where it goes and After sending." width="1208" height="832" loading="lazy" decoding="async"></figure>

- Click a field type on the left — **Text**, **Email**, **Choice**, **Consent** and the rest — to add it below the selected field.
- Click a field in the middle to change its label, whether it's required, and when it shows. Drag to reorder; drag a field's right edge to set its width.
- On the right: the form's **Name**, its **Button** text ("Say what happens"), what it says **If it can't be sent**, **Appearance** and **Spam protection**.
- **Test** lets you fill the form in as a visitor would.

## Choose where submissions go

Open **Where it goes**. Every submission goes to each destination in the list; the first decides whether the visitor sees the thank-you or the error. **Add a destination**:

- **Inbox** — this app's own inbox, with e-mail alerts and forwarding ([See who wrote in](/docs/editing/inbox/)). The default.
- **HubSpot**, **Marketo**, **Salesforce**, **Pardot (Account Engagement)** — your CRM's own form or lead handler.
- **Webhook** — any address: an automation tool, a function, your own service.
- **E-mail program** — opens the visitor's own mail program. A last resort: nothing is stored.

**After sending** sets the thank-you message (it can quote the visitor's answers) and any further steps.

## Put it on a page

Press **Use this form**, choose a page under **Add it as a … section to**, and **Add to page**. The form appears as one of the site's own form sections; check it in Proof, then publish.

## What can go wrong

- **"Where should the live site send submissions?"** Galley on your own computer can't receive visitors' submissions: the live site's visitors can't reach it. Forms still send to it from the preview, for testing. For the live site, run Galley on a server, or choose a CRM or webhook destination — [See who wrote in](/docs/editing/inbox/#on-the-live-site).
- **The Forms screen offers "Set it up for me".** The site doesn't have Galley's site kit yet. The button adds it as pending changes for you to check; whoever looks after the site's code should look them over. [Forms, for developers](/docs/forms/).
- **The CRM didn't receive anything.** Check the destination's settings against the CRM's form; the CRM's own documentation is linked beside each one. The docs haven't sent to a real CRM.
