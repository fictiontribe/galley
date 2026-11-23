---
title: Why inspections need to work in the basement
description: Plant rooms, cold stores and lift shafts rarely have signal. Here is how we built Ferrow's inspection app to stop losing work there.
date: 2026-10-21
author: tobi-merriden
image: /images/blog/offline-first.svg
imageAlt: A phone showing an inspection checklist, with a sync indicator waiting for signal.
tags: [Product, Inspections]
---

The places that most need inspecting are the places phones work worst: plant rooms below ground, cold stores lined with steel, lift motor rooms on the roof. For years, our own app treated a lost connection as an error. This autumn we rebuilt it so that losing signal is simply normal.

## What went wrong before

The old app saved each answer to our servers as you went. In a basement, an answer could take thirty seconds to save, or fail silently. Engineers learned to write answers on paper and type them up in the car park — which defeated the point.

## Offline by default

The new app downloads a week of work before you set off: every inspection assigned to you, its checklist, the asset's history and any reference photos. Everything you record is saved on the phone first. When the phone finds a connection, the app sends what has changed, in order, and tells you when it is done.

We made three decisions along the way that are worth sharing.

**Show the queue.** A small banner says how many inspections are waiting to sync and when the last sync happened. People trust a system that tells them what it has not done yet.

**Never lose a photo.** Photos are the largest part of an inspection and the most painful to retake. They are stored on the phone until our servers confirm they have arrived, and only then removed.

**Make conflicts a person's decision.** If two people edit the same inspection while offline, we keep both versions and ask a manager to choose. Merging them automatically would be clever, and occasionally wrong in a way nobody notices.

## What we measured

In the pilot, the share of inspections recorded on site — rather than typed up later — rose from 61% to 94%. The time between finishing a check and it appearing in the office fell from a median of four hours to eleven minutes.

Offline mode is available on every plan from version 4.6. The details are in the [changelog](/changelog/).
