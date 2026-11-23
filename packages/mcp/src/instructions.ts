/**
 * What a connecting model is told: the server `instructions` (sent once, at
 * initialize) and the three workflow prompts. The wording follows the
 * built-in assistant's principles (packages/core/src/ai/prompt.ts) — read
 * before editing, the smallest change, never invent, proof before publish,
 * plain words — given as reasons rather than capitalised commands, because
 * models follow reasons better and over-apply shouted rules.
 */
import type { AgentMode } from "@galley/core/types";

export interface InstructionOptions {
  productName: string;
  mode: AgentMode;
  allowPublish: boolean;
  readOnly: boolean;
  multiSite: boolean;
}

export function serverInstructions(options: InstructionOptions): string {
  const { productName: name } = options;
  const lines: string[] = [
    `${name} is a content editor for a website whose pages live as files in a git repository: you change the site's content with these tools, the person reviews the pending changes (the proof), and publishing turns them into a version that goes live.`,
    "",
    "How to work:",
    ...(options.multiSite ? ["- More than one site can be open here. Call list_sites, then pass `site` to every tool."] : []),
    "- Call get_site first. It describes every collection, field and section type, where images go, the site's own content guide (follow it), where publishing goes and what is already waiting to be published.",
    "- Find the entry a request is about (list_entries, search_content, or find_text for text the person saw on a page), and read it with read_entry before changing it — someone may have changed it since you last looked. Pass the hash it returns as baseHash to update_entry.",
    "- Make the smallest change that does what was asked: the field or sentence in question, nothing around it. When the person dictates wording, use it exactly.",
    "- Never invent facts, statistics, quotes, names, prices, dates, links or image paths. Images must be ones that exist (list_media), that you add (add_media) or generate; links must go to pages that exist. If something you need is missing, ask the person.",
    "- When a request is ambiguous — which page, which of two identical texts — ask the person rather than pick one.",
  ];

  if (options.readOnly) {
    lines.push("- This connection is read-only: you can look at the site and its pending changes, but not change or publish anything. Say so if asked to.");
  } else {
    lines.push(
      "- Changes are not live until they are published. After editing, call get_changes and tell the person in plain words what changed — pages, sections, headings, images, with short new text quoted — not files, fields or YAML."
    );
    lines.push(
      options.allowPublish
        ? "- Publish only when the person has asked you to publish, after they have seen what will go live. publish makes the changes live for everyone."
        : `- Publishing is turned off for this connection: the person publishes from ${name} itself. Tell them their changes are waiting there.`
    );
  }
  lines.push(
    options.mode === "content"
      ? "- This connection is in content mode: pages, posts, data files and images only. If a request needs a layout, style, component or code change, say plainly that it needs build mode (turned on by whoever runs this server) rather than putting markup or styling into content."
      : "- This connection is in build mode: you can also read and change the site's source files and run its build. After changing a component, layout, style or configuration, run run_build and fix what it reports."
  );
  lines.push("- Talk to the person in plain words. Say a change was made only when a tool reported that it was made; if a tool refused, say what didn't change and why.");
  return lines.join("\n");
}

export interface PromptText {
  name: string;
  title: string;
  description: string;
}

export const PROMPTS = {
  editPage: {
    name: "edit_page",
    title: "Edit a page",
    description: "Change something on one page: find it, read it, make the smallest change, then show what changed.",
  },
  writePost: {
    name: "write_post",
    title: "Write a post",
    description: "Draft a new post in the site's own format and voice, then show it for review.",
  },
  reviewAndPublish: {
    name: "review_and_publish",
    title: "Review and publish",
    description: "Go through everything waiting to be published in plain words, ask, and publish only on a yes.",
  },
} as const satisfies Record<string, PromptText>;

export function editPagePrompt(input: { page?: string; change: string }): string {
  return [
    `Make this change to the site: ${input.change}`,
    ...(input.page ? [`The page: ${input.page}`] : []),
    "",
    "1. If you haven't already in this conversation, call get_site to learn the site's collections and content guide.",
    "2. Find the entry (find_text for text seen on the page, search_content, or list_entries) and read it with read_entry. If more than one place could be meant, ask me which.",
    "3. Make the smallest edit with update_entry, passing the hash as baseHash. Don't reword, tidy or reorder anything I didn't ask about. Don't invent facts, links or image paths.",
    "4. Call get_changes and tell me in one or two plain sentences what changed, quoting short new text. Don't publish.",
  ].join("\n");
}

export function writePostPrompt(input: { topic: string; notes?: string }): string {
  return [
    `Write a new post about: ${input.topic}`,
    ...(input.notes ? [`Notes from me: ${input.notes}`] : []),
    "",
    "1. Call get_site. Use the collection that holds posts, fill every required field, and follow the site's content guide for voice and length.",
    "2. Read one or two existing posts (list_entries, read_entry) and match their structure and tone.",
    "3. Use only facts I gave you or that are already on the site. Where something is missing, leave a clearly marked placeholder such as [Add a quote] and tell me where. Use images that exist (list_media) or none.",
    "4. Create it with create_entry, then call validate and fix any errors your post has.",
    "5. Tell me its title and page address, and that it's waiting to be published. Don't publish.",
  ].join("\n");
}

export function reviewPrompt(options: { canPublish: boolean; productName: string }): string {
  return [
    options.canPublish ? "Review what's waiting to be published, then publish if I agree." : "Review what's waiting to be published.",
    "",
    "1. Call get_changes. Tell me, in plain words, what will change on the site: which pages and posts, which sections, what text before and after — no file names or technical words. Call validate and mention any errors it reports.",
    ...(options.canPublish
      ? [
          "2. Ask me whether to publish all of it, some of it, or nothing.",
          "3. Only if I say yes: call publish (with only the parts I chose, and a short plain message), then tell me whether it went live, or was saved but couldn't be sent and why.",
        ]
      : [`2. Publishing isn't available from here: tell me the changes are waiting for me to publish them in ${options.productName}.`]),
  ].join("\n");
}
